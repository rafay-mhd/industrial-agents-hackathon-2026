from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock,patch
from fastapi.testclient import TestClient
from PIL import Image
from shapely.geometry import Polygon
from agent.plan_builder import Extraction,Calibration,assemble,render_pages,validate_import
from agent.server import create_app
ROOT=Path(__file__).resolve().parents[2]

def extraction():
    return Extraction.model_validate({'spaces':[{'id':'a','name':'Copper hall','type':'hall','room_type':'hall','polygon':[[0,0],[100,0],[100,100],[0,100]]}],'openings':[],'assets':[]})
def calibration(**extra):
    return Calibration(page=0,a=(0,0),b=(1,0),length_m=10,level=0,**extra)
def draft():return assemble('Fresh calibrated house',[(extraction(),calibration(),(100,100))])
class PlanTests(unittest.TestCase):
    def test_scale_and_axes_and_degenerate_calibration(self):
        data=draft();self.assertAlmostEqual(Polygon(data['spaces'][0]['polygon']).area,100)
        self.assertEqual(data['building']['geometry_status'],'draft')
        self.assertEqual(data['spaces'][0]['polygon'][2],[10.,-10.])
        with self.assertRaises(ValueError):assemble('Bad',[(extraction(),Calibration(page=0,a=(0,0),b=(.01,0),length_m=10,level=0),(100,100))])
    def test_images_and_pdf_are_rasterized_and_bad_files_fail(self):
        for kind in ('PNG','PDF'):
            with self.subTest(kind=kind):
                f=BytesIO();Image.new('RGB',(200,100),'white').save(f,format=kind)
                pages=render_pages(f.getvalue(),'plan.'+kind.lower());self.assertEqual(len(pages),1)
                self.assertEqual(pages[0].mode,'RGB');self.assertGreater(pages[0].width,pages[0].height)
        with self.assertRaises(ValueError):render_pages(b'not an image','no.png')
    def test_invalid_geometry_and_nonfinite_metadata_are_rejected(self):
        data=draft();data['spaces'][0]['polygon'][0][0]=float('nan')
        with self.assertRaises(ValueError):validate_import(data)
    def test_different_floor_heights_and_alignment_link_only_matching_shafts(self):
        value=extraction();value.spaces[0].type='lift';value.spaces[0].connector_ref='Lift A'
        c1=calibration(height_m=4);c2=Calibration(page=1,a=(0,0),b=(1,0),length_m=10,level=1,height_m=3)
        data=assemble('Two floors',[(value,c1,(100,100)),(value,c2,(100,100))])
        self.assertEqual(data['floors'][1]['elevation_m'],4);self.assertEqual(len(data['vertical_connectors']),1)
        value2=extraction();value2.spaces[0].type='lift';value2.spaces[0].connector_ref='Lift B'
        self.assertEqual(assemble('Different shafts',[(value,c1,(100,100)),(value2,c2,(100,100))])['vertical_connectors'],[])
class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.output=Path(self.temp.name)
        self.app=create_app(ROOT/'data/dev',self.output,client_factory=Mock)
        self.client=TestClient(self.app);self.addCleanup(self.client.close)
    def test_json_import_registers_persists_and_does_not_overwrite_collisions(self):
        data=draft();result=self.client.post('/buildings/import',files={'file':('house.json',json.dumps(data),'application/json')})
        self.assertEqual(result.status_code,200,result.text);identifier=result.json()['building']['building']['id']
        self.assertEqual(self.client.get('/buildings/'+identifier).status_code,200)
        data['building']['name']='Another house'
        result=self.client.post('/buildings/import',files={'file':('house.json',json.dumps(data),'application/json')})
        self.assertNotEqual(result.json()['building']['building']['id'],identifier)
        with TestClient(create_app(ROOT/'data/dev',self.output,client_factory=Mock)) as restored:
            self.assertEqual(restored.get('/buildings/'+identifier).status_code,200)
    def test_image_preview_calibrated_build_and_registration(self):
        f=BytesIO();Image.new('RGB',(100,100),'white').save(f,format='PNG')
        result=self.client.post('/imports/preview',files={'files':('plan.png',f.getvalue(),'image/png')})
        self.assertEqual(result.status_code,200,result.text);preview=result.json()
        self.assertEqual(self.client.get(preview['pages'][0]['url']).status_code,200)
        with patch('agent.imports.extract',return_value=extraction()) as vision:
            request={'upload_id':preview['upload_id'],'name':'New','floors':[calibration().model_dump()]}
            built=self.client.post('/imports/build',json=request)
            repeated=self.client.post('/imports/build',json=request)
            self.assertEqual(repeated.json(),built.json());vision.assert_called_once()
        self.assertEqual(built.status_code,200,built.text)
        self.assertEqual(self.client.get('/buildings/'+built.json()['building']['building']['id']).status_code,200)
    def test_rejects_invalid_json_and_unknown_upload(self):
        self.assertEqual(self.client.post('/buildings/import',files={'file':('bad.json','{"building":NaN}','application/json')}).status_code,422)
        result=self.client.post('/imports/build',json={'upload_id':'0'*32,'name':'New','floors':[calibration().model_dump()]})
        self.assertEqual(result.status_code,404)
