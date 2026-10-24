"""ElevenLabs speech I/O only. BuildingAgent remains the sole reasoning/tool agent."""

import os
from itertools import zip_longest
from pathlib import Path
import re

import httpx
from fastapi import File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

MAX_AUDIO_BYTES = 10 * 1024 * 1024
AUDIO_TYPES = {'audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg',
               'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'video/mp4'}
DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb'


def building_keyterms(data: dict) -> list[str]:
    """Vocabulary comes from the selected building, including newly registered buildings."""
    groups = []
    for collection in ('vertical_connectors', 'assets', 'spaces', 'floors'):
        candidates = []
        for item in data.get(collection, []):
            for value in (item.get('name'), item.get('ref')):
                if not isinstance(value, str):
                    continue
                term = re.sub(r'[<>{}\[\]\\]', '', value).strip()
                # The provider counts words after punctuation normalization, including room decimals.
                if term and len(term) < 50 and len(re.findall(r'\w+', term)) <= 5:
                    candidates.append(term)
        groups.append(candidates)
    terms, byte_count = [], 0
    # Balance rooms/assets/floors. A conservative byte budget also avoids the provider's
    # observed 5,000-token aggregate limit, including for non-Latin building names.
    for row in zip_longest(*groups):
        for term in row:
            if term is None or term in terms:
                continue
            size = len(term.encode('utf-8'))
            if byte_count + size > 3500:
                continue
            terms.append(term); byte_count += size
            if len(terms) == 100:
                return terms
    return terms


def speech_text(text: str) -> str:
    # Presentation cleanup only: never summarize or change building facts/numbers with an LLM.
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    text = re.sub(r'^\s*#{1,6}\s*', '', text, flags=re.M)
    text = text.replace('**', '').replace('__', '').replace('`', '')
    return text.strip()


class ElevenLabsVoice:
    def __init__(self, *, api_key=None, voice_id=None, transport=None):
        self.api_key = api_key if api_key is not None else os.environ.get('ELEVENLABS_API_KEY', '')
        self.voice_id = voice_id or os.environ.get('ELEVENLABS_VOICE_ID') or DEFAULT_VOICE
        self.transport = transport

    def request(self, path, **kwargs):
        if not self.api_key.strip():
            raise HTTPException(503, 'ElevenLabs is not configured. Set ELEVENLABS_API_KEY on the server.')
        try:
            with httpx.Client(base_url='https://api.elevenlabs.io/v1/',
                              headers={'xi-api-key': self.api_key}, transport=self.transport,
                              timeout=httpx.Timeout(90, connect=10), follow_redirects=False) as client:
                response = client.post(path, **kwargs)
        except httpx.TimeoutException:
            raise HTTPException(504, 'ElevenLabs timed out. Retry the audio request.') from None
        except httpx.RequestError:
            raise HTTPException(502, 'Could not reach ElevenLabs. Text chat is still available.') from None
        if response.status_code == 429:
            raise HTTPException(429, 'ElevenLabs is rate limited or out of credits. Retry later or check the account.')
        if response.status_code in (401, 403):
            raise HTTPException(503, 'ElevenLabs rejected this key or its permissions. Check speech access and credits.')
        if response.status_code == 400 and path == 'speech-to-text' and kwargs.get('data', {}).get('keyterms'):
            try:
                keyword_error = response.json().get('detail', {}).get('status') == 'keyword_validation_error'
            except (ValueError, AttributeError):
                keyword_error = False
            if keyword_error:
                # Optional hints must never prevent a valid building's audio from being transcribed.
                # Retry once without hints; the review/edit step still applies. No chat/tool replay.
                return self.request(path, **{**kwargs, 'data': {k:v for k,v in kwargs['data'].items() if k != 'keyterms'}})
        if not response.is_success:
            raise HTTPException(502, 'ElevenLabs could not process this request. Check the audio, voice configuration and account credits.')
        return response

    def transcribe(self, audio: bytes, content_type: str, keyterms: list[str], language_code=None):
        data = {'model_id': 'scribe_v2', 'tag_audio_events': 'false', 'diarize': 'false',
                'timestamps_granularity': 'word', 'keyterms': keyterms}
        if language_code:
            data['language_code'] = language_code
        response = self.request('speech-to-text', data=data,
                                files={'file': ('recording', audio, content_type)})
        try:
            payload = response.json()
            text = payload['text'].strip()
            if not text or (payload.get('words') and not any(w.get('type') == 'word' for w in payload['words'])):
                raise HTTPException(422, 'No speech detected. Record your question again or type it.')
            if len(text) > 12000:
                raise HTTPException(422, 'The transcript is too long. Record a shorter question.')
            return dict(text=text, language_code=payload.get('language_code'),
                        language_probability=payload.get('language_probability'), needs_review=True)
        except (ValueError, KeyError, AttributeError, TypeError):
            raise HTTPException(502, 'ElevenLabs returned an invalid transcript.') from None

    def synthesize(self, text: str) -> bytes:
        text = speech_text(text)
        if not text:
            raise HTTPException(422, 'No readable text to speak.')
        response = self.request('text-to-speech/' + self.voice_id,
                                params={'output_format': 'mp3_44100_128'},
                                json={'text': text, 'model_id': 'eleven_multilingual_v2'})
        if not response.headers.get('content-type', '').startswith('audio/') or not response.content:
            raise HTTPException(502, 'ElevenLabs returned no playable audio.')
        return response.content


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=1, max_length=10000)

    @field_validator('text')
    @classmethod
    def nonblank(cls, text):
        if not text.strip():
            raise ValueError('Text must not be blank')
        return text


def install_voice(app, catalog, voice_factory=None):
    factory = voice_factory or ElevenLabsVoice
    assets = Path(__file__).parent / 'static'
    app.mount('/voice-assets', StaticFiles(directory=assets), name='voice-assets')

    @app.get('/voice', include_in_schema=False)
    def voice_page():
        return FileResponse(assets / 'voice.html', headers={'Cache-Control': 'no-store'})

    @app.get('/voice/status')
    def voice_status():
        return {'configured': bool(os.environ.get('ELEVENLABS_API_KEY', '').strip()),
                'speech_to_text': 'scribe_v2', 'text_to_speech': 'eleven_multilingual_v2'}

    @app.post('/buildings/{building_id}/transcribe')
    async def transcribe(building_id: str, file: UploadFile = File(...),
                         language_code: str | None = Form(None, pattern=r'^[a-z]{2,3}$')):
        # Check building before any billable provider request. Transcription never mutates a session.
        try:
            data = catalog.get(building_id)
            content_type = (file.content_type or '').split(';', 1)[0].lower()
            if content_type not in AUDIO_TYPES:
                raise HTTPException(415, 'Use a WebM, MP4/M4A, WAV, MP3, Ogg, AAC or FLAC recording.')
            chunks, size = [], 0
            while chunk := await file.read(64 * 1024):
                size += len(chunk)
                if size > MAX_AUDIO_BYTES:
                    raise HTTPException(413, 'Recording exceeds 10 MB. Record a shorter question.')
                chunks.append(chunk)
            if not size:
                raise HTTPException(422, 'The recording is empty.')
            return await run_in_threadpool(factory().transcribe, b''.join(chunks), content_type,
                                           building_keyterms(data), language_code)
        finally:
            await file.close()

    @app.post('/tts')
    def tts(request: SpeechRequest):
        return Response(factory().synthesize(request.text), media_type='audio/mpeg',
                        headers={'Cache-Control': 'no-store'})
