"""Speech transport, building isolation, and the unchanged agent boundary."""
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient

from agent.agent import BuildingAgent
from agent.server import create_app
from agent.voice import ElevenLabsVoice, MAX_AUDIO_BYTES, building_keyterms, speech_text

ROOT = Path(__file__).resolve().parents[2]
FACTORY = 'proc-factory-dev-003'


class VoiceProviderTests(unittest.TestCase):
    def provider(self, handler):
        return ElevenLabsVoice(api_key='unit-secret', transport=httpx.MockTransport(handler))

    def test_exhausted_credits_are_not_reported_as_bad_credentials(self):
        provider=self.provider(lambda r:httpx.Response(401,json={'detail':{'status':'quota_exceeded'}}))
        for call in (lambda:provider.synthesize('Hello'),lambda:provider.open_speech_stream('Hello')):
            with self.assertRaises(HTTPException) as caught:call()
            self.assertEqual(caught.exception.status_code,429)
            self.assertIn('credits are exhausted',caught.exception.detail)

    def test_streaming_pcm_and_short_lived_tokens(self):
        def handler(request):
            if request.url.path.endswith('realtime_scribe'):
                return httpx.Response(200,json={'token':'ephemeral-test-token'})
            self.assertEqual(request.url.params['output_format'],'pcm_24000')
            payload=json.loads(request.content)
            self.assertEqual(payload['model_id'],'eleven_flash_v2_5')
            self.assertEqual(payload['text'],'Turn left.')
            return httpx.Response(200,content=b'\x00\x01'*4000)
        provider=self.provider(handler)
        self.assertEqual(provider.realtime_token(),'ephemeral-test-token')
        self.assertEqual(len(b''.join(provider.open_speech_stream('**Turn left.**'))),8000)
        for code in (401,429,500):
            with self.assertRaises(HTTPException):
                self.provider(lambda r:httpx.Response(code)).open_speech_stream('Hello')

    def test_stt_is_multipart_and_tts_uses_only_the_requested_text(self):
        requests = []
        def handle(request):
            requests.append(request)
            self.assertEqual(request.headers['xi-api-key'], 'unit-secret')
            if request.url.path == '/v1/speech-to-text':
                body = request.read().decode()
                for field in ['scribe_v2','Office 1.20','Office lift','recorded audio','language_code']:
                    self.assertIn(field,body)
                self.assertEqual(body.count('name="keyterms"'),2)
                return httpx.Response(200,json={'text':'Office 1.20','language_code':'en',
                                                'words':[{'type':'word','text':'Office'}]})
            self.assertEqual(request.url.path, '/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb')
            self.assertEqual(json.loads(request.content)['text'],'Office 1.20 is 29.6 m².')
            return httpx.Response(200,content=b'ID3audio',headers={'content-type':'audio/mpeg'})
        provider = self.provider(handle)
        result=provider.transcribe(b'recorded audio','audio/webm',['Office 1.20','Office lift'],'en')
        self.assertTrue(result['needs_review'])
        self.assertEqual(provider.synthesize('**Office 1.20** is 29.6 m².'),b'ID3audio')
        self.assertEqual(len(requests),2)

    def test_errors_do_not_expose_provider_bodies_or_credentials(self):
        for upstream, expected in [(401,503),(403,503),(429,429),(500,502),(302,502)]:
            with self.subTest(status=upstream):
                provider=self.provider(lambda req:httpx.Response(upstream,text='unit-secret private provider body'))
                with self.assertRaises(HTTPException) as caught: provider.synthesize('Hello')
                self.assertEqual(caught.exception.status_code,expected)
                self.assertNotIn('unit-secret',caught.exception.detail)

    def test_missing_key_timeout_empty_or_invalid_provider_payload(self):
        def timeout(request): raise httpx.ReadTimeout('private',request=request)
        providers=[(ElevenLabsVoice(api_key=''),503), (self.provider(timeout),504),
                   (self.provider(lambda r:httpx.Response(200,json={})),502)]
        for provider,code in providers:
            with self.assertRaises(HTTPException) as caught: provider.synthesize('Hello')
            self.assertEqual(caught.exception.status_code,code)
        for payload,code in [({'text':'','words':[]},422),({'text':'noise','words':[{'type':'audio_event'}]},422),({},502)]:
            with self.assertRaises(HTTPException) as caught:
                self.provider(lambda r:httpx.Response(200,json=payload)).transcribe(b'a','audio/wav',[])
            self.assertEqual(caught.exception.status_code,code)

    def test_keyterm_limits_and_factual_speech_cleanup(self):
        data={'spaces':[{'name':f'Office {i}.20','ref':str(i)} for i in range(1200)]}
        terms=building_keyterms(data)
        self.assertEqual(len(terms),100)
        self.assertEqual(len(set(terms)),len(terms))
        self.assertEqual(building_keyterms({'spaces':[{'name':'one two three four five six'}, {'name':'<Office> [1.20]'}]}),['Office 1.20'])
        self.assertEqual(speech_text('## Route\n**Office 1.20** → Kitchen 0.28: 53.87 m'),
                         'Route\nOffice 1.20 → Kitchen 0.28: 53.87 m')

    def test_all_supplied_buildings_fit_provider_vocabulary_limits(self):
        files=list((ROOT/'data').glob('*/*/building.json'))
        self.assertEqual(len(files),280)
        for path in files:
            terms=building_keyterms(json.loads(path.read_text()))
            self.assertLessEqual(len(terms),100)
            self.assertLessEqual(sum(len(t.encode('utf-8')) for t in terms),3500)
            self.assertTrue(all(len(t)<50 for t in terms))
            live=building_keyterms(json.loads(path.read_text()),max_terms=50,max_characters=20)
            self.assertLessEqual(len(live),50)
            self.assertTrue(all(len(t)<=20 for t in live))

    def test_realtime_vocabulary_skips_long_names_without_losing_short_room_refs(self):
        data={'assets':[{'name':'Fire extinguisher H-A1'}],
              'spaces':[{'name':'An exceptionally long room name','ref':'1.20'}, {'name':'Office 1.20'}]}
        self.assertIn('Fire extinguisher H-A1',building_keyterms(data))
        self.assertEqual(building_keyterms(data,max_terms=50,max_characters=20),['1.20','Office 1.20'])

    def test_keyword_rejection_retries_only_transcription_once_without_hints(self):
        requests=[]
        def handler(request):
            requests.append(request)
            if len(requests)==1:
                return httpx.Response(400,json={'detail':{'status':'keyword_validation_error'}})
            self.assertNotIn(b'name="keyterms"',request.content)
            return httpx.Response(200,json={'text':'Office 1.20'})
        result=self.provider(handler).transcribe(b'audio','audio/wav',['Office 1.20'])
        self.assertEqual(result['text'],'Office 1.20')
        self.assertEqual(len(requests),2)


class VoiceAPITests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.voice=Mock()
        self.voice.transcribe.return_value={'text':'How big is Office 1.20?', 'needs_review':True,
                                            'language_code':'en','language_probability':.99}
        self.voice.synthesize.return_value=b'ID3audio'
        self.app=create_app(ROOT/'data/dev',Path(self.temp.name),client_factory=Mock,voice_factory=lambda:self.voice)
        self.client=TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_streaming_endpoints_keep_main_key_server_side_and_validate_building(self):
        self.voice.realtime_token.return_value='ephemeral-test-token'
        self.voice.open_speech_stream.return_value=iter([b'\x00\x01',b'\x02\x03'])
        response=self.client.post(f'/buildings/{FACTORY}/voice-token')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['token'],'ephemeral-test-token')
        self.assertLessEqual(len(response.json()['keyterms']),50)
        self.assertTrue(all(len(t)<=20 for t in response.json()['keyterms']))
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(self.client.post('/buildings/missing/voice-token').status_code,404)
        self.voice.realtime_token.assert_called_once()
        audio=self.client.post('/tts/stream',json={'text':'Turn left.'})
        self.assertEqual(audio.content,b'\x00\x01\x02\x03')
        self.assertEqual(audio.headers['x-audio-sample-rate'],'24000')

    def transcript(self,identifier=FACTORY,data=b'audio',mime='audio/webm'):
        return self.client.post(f'/buildings/{identifier}/transcribe',files={'file':('question',data,mime)})

    def test_voice_reaches_same_chat_session_and_core_without_another_agent(self):
        transcript=self.transcript()
        self.assertEqual(transcript.status_code,200)
        self.assertEqual(self.app.state.sessions,{}) # transcription waits for user review
        def ask(agent,message):
            self.assertEqual(message,transcript.json()['text'])
            tools={t.name:t for t in agent.tools}
            if agent.context.position is None:
                tools['remember_context'].call({'position':'Office 1.20','step_free':True})
            self.assertTrue(agent.context.step_free)
            return f"Understood: Office 1.20\nIts area is {agent.map.area_m2('Office 1.20')} m²."
        with patch.object(BuildingAgent,'ask',ask):
            for _ in range(2):
                reply=self.client.post(f'/buildings/{FACTORY}/chat',json={'session_id':'shared','message':transcript.json()['text']})
                self.assertEqual(reply.status_code,200)
        self.assertEqual(len(self.app.state.sessions),1)
        audio=self.client.post('/tts',json={'text':reply.json()['reply']})
        self.assertEqual(audio.headers['content-type'],'audio/mpeg')
        self.voice.synthesize.assert_called_once_with(reply.json()['reply'])
        self.assertEqual(audio.headers['cache-control'],'no-store')

    def test_building_vocabulary_and_new_buildings_are_dynamic(self):
        self.assertEqual(self.transcript().status_code,200)
        first_terms=self.voice.transcribe.call_args.args[2]
        self.assertIn('Production zone H-A1',first_terms)
        custom=deepcopy(self.app.state.catalog.get(FACTORY))
        custom['building']['id']='brand-new-building'
        custom['spaces'][0]['name']='Quantum workshop 42'
        self.app.state.catalog.add_data(custom)
        self.assertEqual(self.transcript('brand-new-building').status_code,200)
        self.assertIn('Quantum workshop 42',self.voice.transcribe.call_args.args[2])
        self.assertNotIn('Quantum workshop 42',first_terms)

    def test_invalid_uploads_and_unknown_buildings_do_not_call_provider(self):
        for identifier,data,mime,code in [('missing',b'a','audio/wav',404), (FACTORY,b'','audio/wav',422),
                                         (FACTORY,b'a','text/html',415),
                                         (FACTORY,b'a'*(MAX_AUDIO_BYTES+1),'audio/wav',413)]:
            with self.subTest(code=code): self.assertEqual(self.transcript(identifier,data,mime).status_code,code)
        self.voice.transcribe.assert_not_called()
        self.assertEqual(self.app.state.sessions,{})

    def test_tts_failure_does_not_replay_or_undo_agent_turn(self):
        with patch.object(BuildingAgent,'ask',return_value='Understood: Hello\nHow can I help?') as ask:
            reply=self.client.post(f'/buildings/{FACTORY}/chat',json={'session_id':'one','message':'hello'})
            self.voice.synthesize.side_effect=HTTPException(429,'Speech rate limited')
            for _ in range(2): self.assertEqual(self.client.post('/tts',json={'text':reply.json()['reply']}).status_code,429)
            ask.assert_called_once()
        self.assertEqual(len(self.app.state.sessions),1)

    def test_page_assets_and_validation(self):
        self.assertIn('Review your question',self.client.get('/voice').text)
        js=self.client.get('/voice-assets/voice.js').text
        self.assertIn('getUserMedia',js)
        self.assertNotIn('SpeechRecognition',js)
        for text in ['', ' ', 'a'*10001]:
            self.assertEqual(self.client.post('/tts',json={'text':text}).status_code,422)
        self.voice.synthesize.assert_not_called()


if __name__=='__main__': unittest.main()
