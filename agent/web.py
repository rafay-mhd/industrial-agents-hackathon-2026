"""One origin for the built Inside UI, GLB assets and the existing building agent.

Build first: npm --prefix ui run build
Run: uv run --env-file .env uvicorn agent.web:app --host 127.0.0.1 --port 8012
"""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[1]


def create_web_app(api: FastAPI | None = None, ui_dist: Path | None = None) -> FastAPI:
    if api is None:
        from agent.server import app as api
    app = FastAPI(title="Inside — Team Simran", docs_url=None, redoc_url=None, openapi_url=None)
    app.mount('/api', api)
    directory = ui_dist if ui_dist is not None else ROOT / 'ui' / 'dist'
    if (directory / 'index.html').is_file():
        app.mount('/', StaticFiles(directory=directory, html=True), name='inside')
    else:
        @app.get('/')
        def missing_build():
            raise HTTPException(503, 'Build the frontend with npm --prefix ui run build, then restart this server. The API is available under /api.')
    return app


app = create_web_app()
