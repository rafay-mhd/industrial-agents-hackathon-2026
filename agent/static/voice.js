// Speech transport for our existing /chat agent. No ElevenAgents or browser speech fallback.
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let buildingId = params.get('building_id') || '';
let sessionId = params.get('session_id') || crypto.randomUUID();
let busy = false, recorder = null, stream = null, timer = null, currentAudio = null, abandoned = false;
const objectUrls = new Set();

function status(text) { $('status').textContent = text; }
function controls(working) {
  busy = working;
  for (const id of ['building','new','refresh','record','upload','send','language','question'])
    $(id).disabled = working || (!buildingId && !['refresh','language','question'].includes(id));
  $('stop').disabled = !recorder || recorder.state !== 'recording';
}
async function checked(response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${response.status}).`);
  }
  return response;
}
function stopAudio() { if (currentAudio) currentAudio.pause(); }
function resetConversation() {
  stopAudio(); sessionId = crypto.randomUUID(); $('conversation').replaceChildren(); $('question').value = '';
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear(); status('New conversation. Tell me where you are when asking for directions.');
}
async function loadBuildings() {
  controls(true);
  try {
    const buildings = await (await checked(await fetch('/buildings'))).json();
    $('building').replaceChildren(...buildings.map(b => new Option(`${b.name} · ${b.id}`, b.id)));
    if (!buildings.some(b => b.id === buildingId)) { buildingId = buildings[0]?.id || ''; resetConversation(); }
    $('building').value = buildingId;
    const configuration = await (await checked(await fetch('/voice/status'))).json();
    status(configuration.configured ? 'Ready. Record a question or type below.' : 'ElevenLabs is not configured. Text chat is available.');
  } catch (error) { status(error.message); }
  finally { controls(false); }
}
async function transcribe(blob) {
  if (!blob.size) throw new Error('No audio was recorded. Try again.');
  if (blob.size > 10 * 1024 * 1024) throw new Error('Recording exceeds 10 MB. Use a shorter clip.');
  status('Transcribing your question with ElevenLabs…');
  const form = new FormData(); form.append('file', blob, 'question');
  if ($('language').value) form.append('language_code', $('language').value);
  const result = await (await checked(await fetch(`/buildings/${encodeURIComponent(buildingId)}/transcribe`, {method:'POST',body:form}))).json();
  $('question').value = result.text;
  status('Check the transcript, especially room numbers, then press Send.');
}
$('record').onclick = async () => {
  if (busy) return;
  controls(true); stopAudio();
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('This browser cannot record here. Use localhost/HTTPS, choose an audio file, or type your question.');
    stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
    const mime = ['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, mime ? {mimeType:mime} : undefined);
    const chunks = []; let recordingFailed = false;
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onerror = () => { recordingFailed = true; status('Recording failed. Try again or choose an audio file.'); };
    recorder.onstop = async () => {
      clearTimeout(timer); stream?.getTracks().forEach(t=>t.stop()); $('stop').disabled = true;
      try { if (!recordingFailed && !abandoned) await transcribe(new Blob(chunks,{type:recorder.mimeType})); }
      catch (error) { status(error.message); }
      finally { recorder = null; stream = null; controls(false); }
    };
    recorder.start(); timer = setTimeout(()=>{if(recorder?.state==='recording') recorder.stop();},60000);
    $('stop').disabled = false; status('Recording… Press Stop when finished (maximum 60 seconds).');
  } catch (error) { stream?.getTracks().forEach(t=>t.stop()); stream=null; recorder=null; controls(false); status(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser, choose a recording, or type below.' : error.message); }
};
$('stop').onclick = () => { if (recorder?.state === 'recording') recorder.stop(); };
$('upload').onchange = async () => {
  const file = $('upload').files[0]; if (!file || busy) return;
  controls(true); stopAudio();
  try { await transcribe(file); } catch (error) { status(error.message); }
  finally { $('upload').value=''; controls(false); }
};
async function speak(text, container, autoplay=true) {
  stopAudio();
  // The agent normally gives short answers. Chunk long replies without dropping any text.
  const chunks = text.match(/[\s\S]{1,4000}(?:\s|$)|[\s\S]{1,4000}/g) || [];
  const players = [];
  for (const chunk of chunks) {
    const response = await checked(await fetch('/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:chunk})}));
    const url = URL.createObjectURL(await response.blob()); objectUrls.add(url);
    const audio = document.createElement('audio'); audio.controls=true; audio.src=url; audio.setAttribute('aria-label','Spoken agent reply');
    audio.onplay=()=>{if(currentAudio && currentAudio!==audio) currentAudio.pause();currentAudio=audio;};
    container.append(audio); players.push(audio);
  }
  players.forEach((audio,i)=>{audio.onended=()=>{if(players[i+1]) players[i+1].play().catch(()=>status('Press Play to hear the next part.'));};});
  if (autoplay && players[0]) await players[0].play().catch(()=>status('Answer ready. Press Play to hear it.'));
}
$('send').onclick = async () => {
  const message = $('question').value.trim(); if (!message || busy) return;
  controls(true); stopAudio(); status('Your building agent is working…');
  try {
    const result = await (await checked(await fetch(`/buildings/${encodeURIComponent(buildingId)}/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sessionId,message})}))).json();
    const card=document.createElement('article'); card.className='card';
    const question=document.createElement('strong'); question.textContent=message; card.append(question);
    if (result.understood) { const understood=document.createElement('p'); understood.className='caption'; understood.textContent=result.understood; card.append(understood); }
    const answer=document.createElement('p'); answer.textContent=result.reply; card.append(answer);
    for (const action of result.actions) {
      if (action.type==='route') { const route=document.createElement('p'); route.className='caption'; route.textContent=`Route: ${action.length_m} m\n${action.steps.join('\n')}`; card.append(route); }
      if (action.type==='closed' || action.type==='door_added') { const note=document.createElement('p'); note.className='caption'; note.textContent=action.type==='closed' ? 'Building closure state updated for this conversation.' : 'Door added to this conversation’s building map.'; card.append(note); }
    }
    $('conversation').append(card); $('question').value=''; status('Answer ready. Preparing speech…');
    const audioBox=document.createElement('div'); card.append(audioBox);
    const retry=document.createElement('button'); retry.className='secondary'; retry.textContent='Retry speech'; retry.hidden=true; card.append(retry);
    const playReply=async()=>{
      retry.disabled=true; audioBox.replaceChildren();
      try { status('Answer ready.'); await speak(result.reply,audioBox); retry.hidden=true; }
      catch(error) { retry.hidden=false; status(`The agent answered, but speech failed: ${error.message} Retry speech without resending your question.`); }
      finally { retry.disabled=false; }
    };
    retry.onclick=async()=>{if(busy)return;controls(true);try{await playReply();}finally{controls(false);}}; await playReply();
  } catch(error) { status(error.message); }
  finally { controls(false); }
};
$('building').onchange=()=>{buildingId=$('building').value;resetConversation();};
$('new').onclick=resetConversation;
$('refresh').onclick=loadBuildings;
window.addEventListener('pagehide',()=>{abandoned=true;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stopAudio();for(const u of objectUrls)URL.revokeObjectURL(u);});
loadBuildings();
