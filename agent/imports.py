"""Local imports, calibrated floor-plan drafts and durable catalog registration."""
from copy import deepcopy
import json
import hashlib
import os
from pathlib import Path
import re
from threading import Lock
from uuid import uuid4

import anthropic
from fastapi import File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import Field
from PIL import Image
from starlette.concurrency import run_in_threadpool

from agent.plan_builder import Calibration, MAX_BYTES, MAX_PAGES, Strict, assemble, extract, render_pages, validate_import


class BuildRequest(Strict):
    upload_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    name: str = Field(min_length=1,max_length=200)
    floors: list[Calibration] = Field(min_length=1,max_length=MAX_PAGES)


async def read_upload(file):
    content=bytearray()
    try:
        while chunk:=await file.read(64*1024):
            content.extend(chunk)
            if len(content)>MAX_BYTES: raise HTTPException(413,'Use a file under 20 MB.')
        if not content:raise HTTPException(422,'The file is empty.')
        return bytes(content)
    finally:
        await file.close()


def install_imports(app,catalog,storage:Path,client_factory):
    registered=storage/'registered'
    registered.mkdir(parents=True,exist_ok=True)
    for path in registered.glob('*.json'):
        try:
            data,_=validate_import(json.loads(path.read_text()))
            with catalog.lock:
                if data['building']['id'] not in catalog.data:
                    catalog.data[data['building']['id']]=data
        except (ValueError,TypeError,KeyError,OSError):
            continue
    def register(value):
        try:
            data,warnings=validate_import(value)
        except Exception as exc:
            raise HTTPException(422,'The building could not be validated. Check its floor, room and opening geometry.') from exc
        with catalog.lock:
            identifier=data['building']['id']
            if identifier in catalog.data:
                if data==catalog.data[identifier]:return dict(building=data,warnings=warnings)
                identifier='import-'+uuid4().hex[:12]
                data['building']['id']=identifier
            file_id=uuid4().hex
            temporary=registered/(file_id+'.tmp')
            temporary.write_text(json.dumps(data,ensure_ascii=False,allow_nan=False))
            temporary.replace(registered/(file_id+'.json'))
            catalog.data[identifier]=deepcopy(data)
        return dict(building=data,warnings=warnings)

    @app.post('/buildings/import')
    async def import_json(file:UploadFile=File(...)):
        content=await read_upload(file)
        try:
            data=json.loads(content,parse_constant=lambda value:(_ for _ in ()).throw(ValueError('Nonfinite number')))
        except (ValueError,UnicodeError):raise HTTPException(422,'Choose a valid UTF-8 building JSON.') from None
        return await run_in_threadpool(register,data)

    @app.post('/imports/preview')
    async def preview(files:list[UploadFile]=File(...)):
        if not 1<=len(files)<=MAX_PAGES:
            for file in files:await file.close()
            raise HTTPException(422,'Choose 1–12 images or PDF pages.')
        identifier=uuid4().hex;directory=storage/'uploads'/identifier
        directory.mkdir(parents=True,exist_ok=True)
        pages=[]
        try:
            for file in files:
                content=await read_upload(file)
                images=await run_in_threadpool(render_pages,content,file.filename or '')
                if len(images)+len(pages)>MAX_PAGES:
                    raise ValueError('Use at most 12 floor-plan pages per building.')
                for image in images:
                    index=len(pages)
                    path=directory/f'{index}.png';image.save(path)
                    pages.append(dict(index=index,width=image.width,height=image.height,
                        name=file.filename or 'Floor plan',url=f'/imports/{identifier}/pages/{index}'))
                    image.close()
        except (ValueError,OSError) as exc:raise HTTPException(422,str(exc)) from None
        except Exception:raise HTTPException(422,'Could not read this image or PDF. Use an unencrypted, readable plan.') from None
        finally:
            for file in files:await file.close()
        (directory/'pages.json').write_text(json.dumps(pages))
        return dict(upload_id=identifier,pages=pages)

    @app.get('/imports/{upload_id}/pages/{index}')
    def image_page(upload_id:str,index:int):
        if not re.fullmatch('[a-f0-9]{32}',upload_id) or not 0<=index<MAX_PAGES:
            raise HTTPException(404,'Unknown floor-plan page.')
        path=storage/'uploads'/upload_id/f'{index}.png'
        if not path.is_file():raise HTTPException(404,'Unknown floor-plan page.')
        return FileResponse(path,media_type='image/png',headers={'Cache-Control':'no-store'})

    locks={};lock_guard=Lock()
    @app.post('/imports/build')
    def build(request:BuildRequest):
        directory=storage/'uploads'/request.upload_id
        if not (directory/'pages.json').is_file():raise HTTPException(404,'Upload the floor plans first.')
        if len({f.page for f in request.floors})!=len(request.floors):raise HTTPException(422,'Choose each page only once.')
        with lock_guard:lock=locks.setdefault(request.upload_id,Lock())
        if not lock.acquire(blocking=False):raise HTTPException(409,'This plan is already being processed.')
        try:
            cached=directory/('built-'+hashlib.sha256(request.model_dump_json().encode()).hexdigest()+'.json')
            if cached.is_file():return json.loads(cached.read_text())
            # Check every calibration before making billable model calls.
            for c in request.floors:
                path=directory/f'{c.page}.png'
                if not path.is_file():raise ValueError('Unknown floor-plan page.')
                with Image.open(path) as image:
                    w,h=image.size
                if any(not 0<=v<=1 for p in (c.a,c.b) for v in p) or ((c.a[0]-c.b[0])*w)**2+((c.a[1]-c.b[1])*h)**2<225:
                    raise ValueError('Mark two points at least 15 pixels apart on every plan.')
            if len({c.level for c in request.floors})!=len(request.floors):raise ValueError('Each page needs a unique floor level.')
            client=client_factory();pages=[]
            for c in request.floors:
                path=directory/f'{c.page}.png'
                with Image.open(path) as image:size=image.size
                extracted=extract(path,client)
                (directory/f'{c.page}-extraction.json').write_text(extracted.model_dump_json(indent=2))
                pages.append((extracted,c,size))
            data=assemble(request.name.strip(),pages)
            result=register(data)
            result['warnings']=list(dict.fromkeys(data['building']['import_warnings']+result['warnings']))
            cached.write_text(json.dumps(result,ensure_ascii=False,allow_nan=False))
            return result
        except anthropic.APIError:
            raise HTTPException(502,'Floor-plan analysis could not complete. Check model access or credits and retry.') from None
        except ValueError as exc:
            # ValidationError may contain an entire untrusted model payload; keep the response bounded.
            raise HTTPException(422,str(exc)[:700]) from None
        finally:lock.release()

    @app.get('/imports/status')
    def status():
        return dict(configured=bool(os.environ.get('ANTHROPIC_API_KEY','').strip()),supports=['json','png','jpeg','webp','pdf'],max_pages=MAX_PAGES)
