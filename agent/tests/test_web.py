"""The distributable UI and API share one server, including model files."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from agent.web import create_web_app


class WebIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.api = FastAPI()

        @self.api.get('/buildings')
        def buildings():
            return [{'id': 'real-backend-contract'}]

        @self.api.post('/buildings/{building}/chat')
        def chat(building: str, body: dict):
            return {'building': building, 'message': body['message']}

    def test_same_origin_ui_api_and_models(self):
        (self.directory / 'index.html').write_text('<html>Inside</html>')
        (self.directory / 'models').mkdir()
        source = Path(__file__).resolve().parents[2] / 'ui/public/models/chair.glb'
        (self.directory / 'models/chair.glb').write_bytes(source.read_bytes())
        with TestClient(create_web_app(self.api, self.directory)) as client:
            self.assertIn('Inside', client.get('/').text)
            self.assertEqual(client.get('/api/buildings').json(), [{'id': 'real-backend-contract'}])
            self.assertEqual(client.post('/api/buildings/demo/chat', json={'message':'find my room'}).json(),
                             {'building':'demo','message':'find my room'})
            model = client.get('/models/chair.glb')
            self.assertEqual(model.status_code, 200)
            self.assertEqual(model.content[:4], b'glTF')
            self.assertEqual(client.get('/models/missing.glb').status_code, 404)
            self.assertEqual(client.get('/api/missing').status_code, 404)

    def test_api_stays_available_when_ui_has_not_been_built(self):
        with TestClient(create_web_app(self.api, self.directory)) as client:
            self.assertEqual(client.get('/').status_code, 503)
            self.assertEqual(client.get('/api/buildings').status_code, 200)
