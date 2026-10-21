"""Synthetic protocol oracles; these do not qualify speaker accuracy/liveness."""
import base64
import copy
import time
import unittest
from unittest.mock import patch
import worker

class FakeEncoder:
    decoder = 'synthetic-test-decoder'
    def __init__(self): self.calls = 0
    def extract(self, audio, mime, duration):
        self.calls += 1
        return [1.0] + [0.0] * 191

class SyntheticInspector:
    qualified = True
    def inspect(self, data, challenge):
        return {k:True for k in ['challengeVerified','singleLiveSpeaker','replayRejected','syntheticRejected']}

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.encoder=FakeEncoder()
        self.runtime=worker.Runtime(self.encoder,'0'*64)
        self.request={'audio':base64.b64encode(b'synthetic-not-voice').decode(),'mimeType':'audio/wav','challenge':'123456','maxDurationMs':1000}
        self.decode=patch.object(worker,'decode_audio',return_value=bytearray(b'\0'*64000))
        self.decode.start(); self.addCleanup(self.decode.stop)
    def test_default_inspector_abstains_before_embedding(self):
        self.assertFalse(self.runtime.ready()['inspectionQualified'])
        self.assertEqual(self.runtime.operate('/inspect',self.request)['outcome'],'unknown')
        self.assertEqual(self.encoder.calls,0)
    def qualified(self):
        self.runtime=worker.Runtime(self.encoder,'0'*64,SyntheticInspector())
        lease=self.runtime.operate('/inspect',self.request)['inspectionLease']
        return {'audio':self.request['audio'],'mimeType':'audio/wav','inspectionLease':lease}
    def test_one_use_audio_bound_lease(self):
        request=self.qualified()
        result=self.runtime.operate('/extract',request)
        self.assertEqual(len(worker.parse_template(base64.b64decode(result['template']))),192)
        self.assertEqual(self.encoder.calls,1)
        with self.assertRaises(worker.Rejected):self.runtime.operate('/extract',request)
        self.assertEqual(self.encoder.calls,1)
    def test_mutated_audio_consumes_lease(self):
        request=self.qualified(); changed={**request,'audio':base64.b64encode(b'other').decode()}
        with self.assertRaises(worker.Rejected):self.runtime.operate('/extract',changed)
        with self.assertRaises(worker.Rejected):self.runtime.operate('/extract',request)
        self.assertEqual(self.encoder.calls,0)
    def test_expired_lease(self):
        request=self.qualified(); self.runtime.leases[request['inspectionLease']]['expires']=0
        with self.assertRaises(worker.Rejected):self.runtime.operate('/extract',request)
        self.assertEqual(self.encoder.calls,0)
    def test_model_bound_lease(self):
        request=self.qualified(); self.runtime.leases[request['inspectionLease']]['modelDigest']='0'*64
        with self.assertRaises(worker.Rejected):self.runtime.operate('/extract',request)
        self.assertEqual(self.encoder.calls,0)
    def test_purge_removes_inspection_authority(self):
        request=self.qualified();self.assertEqual(self.runtime.operate('/purge',{}),{'purged':True})
        with self.assertRaises(worker.Rejected):self.runtime.operate('/extract',request)
    def test_compare_requires_current_calibration_and_self_only(self):
        vector=[1.0]+[0.0]*191;template=base64.b64encode(worker.encode_template(vector)).decode()
        request={'query':template,'candidates':[{'id':'self','template':template}]}
        self.assertEqual(self.runtime.operate('/compare',request),{})
        self.runtime.inspector = SyntheticInspector()
        self.runtime.match_policy={'threshold':0.99,'expiresAt':int(time.time()*1000)+10000}
        self.assertEqual(self.runtime.operate('/compare',request),{'candidateId':'self'})
        self.runtime.match_policy['expiresAt']=0
        self.assertEqual(self.runtime.operate('/compare',request),{})
        request['candidates'][0]['id']='another-person'
        with self.assertRaises(worker.Rejected):self.runtime.operate('/compare',request)
    def test_invalid_template_model_dimension_nan_rejected(self):
        vector=[1.0]+[0.0]*191
        value=__import__('json').loads(worker.encode_template(vector))
        for change in [{'modelDigest':'0'*64},{'vector':[1.0]},{'vector':[float('nan')]*192}]:
            with self.assertRaises(worker.Rejected):worker.parse_template(__import__('json').dumps({**value,**change}))
    def test_strict_schema_no_operator_inspector_override(self):
        with self.assertRaises(worker.Rejected):self.runtime.operate('/ready',{'qualified':True})
        with self.assertRaises(worker.Rejected):self.runtime.operate('/inspect',{**self.request,'approved':True})
    def test_invalid_audio_and_body_limits(self):
        self.decode.stop()
        with self.assertRaises(worker.Rejected):worker.decode_base64('!invalid',100)
        with self.assertRaises(worker.Rejected):worker.decode_base64('YQ==',0)
        with self.assertRaises(worker.Rejected):worker.decode_audio(b'a','application/json',1000,'unused')
        with self.assertRaises(worker.Rejected):worker.decode_audio(b'a','audio/wav',10001,'unused')

if __name__=='__main__':unittest.main()
