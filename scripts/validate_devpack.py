#!/usr/bin/env python3
"""Validate AGENT REPUBLIC spec-bundle integrity (stdlib only). Not app tests."""
from pathlib import Path
import json,hashlib,re

ROOT=Path(__file__).resolve().parents[1]
DOCS=ROOT/'docs'; EXAMPLES=ROOT/'examples'
REQUIRED=['WHITEPAPER.md','PRD.md','ARCHITECTURE.md','SMART_CONTRACTS.md',
          'AGENT_ENGINE.md','WORLD_ENGINE.md','3D_RENDERING.md','UI_DESIGN.md',
          'IMPLEMENTATION_PLAN.md']
for name in REQUIRED:
    path=DOCS/name
    assert path.is_file() and path.stat().st_size>3000, f'missing/empty: {name}'
    body=path.read_text(encoding='utf-8')
    assert len(re.findall(r'^```',body,flags=re.M))%2==0, f'unbalanced code fences: {name}'

for other in ['AGENTS.md','README.md','CHANGELOG.md','.env.example']:
    assert (ROOT/other).is_file(),f'missing {other}'

frame=json.loads((EXAMPLES/'world-frame.demo.json').read_text(encoding='utf-8'))
scene_envelope=json.loads((EXAMPLES/'scene-manifest.demo.json').read_text(encoding='utf-8'))
assert scene_envelope['demoOnly'] is True, 'scene manifest must be marked as DEMO'
scene=scene_envelope['manifest']
assert frame['schemaVersion']=='1.1' and scene['schemaVersion']=='1.1'
assert frame['simulation']['sceneVersion']==scene['sceneVersion']=='district-01@1'

def digest(obj):
    payload=json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')
    return '0x'+hashlib.sha256(payload).hexdigest()

assert frame['frameId']==digest({k:v for k,v in frame.items() if k not in ('frameId','generatedAt')}), 'DEMO world frame hash mismatch'
assert scene_envelope['manifestHash']==digest(scene), 'DEMO scene manifest hash mismatch'
# The sample follows the production schema, using a synthetic block hash.
assert frame['source']['chainId'] in (56, 97), 'DEMO world frame must use a supported BSC chainId'
assert frame['source']['blockHash']=='0x'+'a'*64, 'DEMO world frame must use the synthetic block hash'
assert frame['facts']['projects'][0]['goalBuild']=='2000'
assert frame['simulation']['agents'] and all(a['isSimulated'] for a in frame['simulation']['agents'])
assert all(m['provenance']=='AI_SIMULATED' and m['moderation']=='APPROVED' for m in frame['society']['publicMessages'])

ids=[b['id'] for b in scene['landmarks']]
assert ids==['COUNCIL','IDENTITY','PROJECT','CORE','PLAZA']
assert len(set(ids))==len(ids)
assert scene['projectBindings']==[{'projectId':'1','landmarkId':'PROJECT'}]
assert scene['agentMaxVisible']==30
for b in scene['landmarks']:
    x,y,z=b['position']; sx,sy,sz=b['bounds']; assert y==0
    assert abs(x)+sx/2<=20 and abs(z)+sz/2<=20
assert len(scene['waypoints'])==13
for a,b in scene['edges']:
    assert a in scene['waypoints'] and b in scene['waypoints']

prd=(DOCS/'PRD.md').read_text(encoding='utf-8')
world=(DOCS/'WORLD_ENGINE.md').read_text(encoding='utf-8')
agent=(DOCS/'AGENT_ENGINE.md').read_text(encoding='utf-8')
render=(DOCS/'3D_RENDERING.md').read_text(encoding='utf-8')
assert 'WorldFrameV1' in prd and 'WorldFrameV1' in world
assert 'AgentObservationV1' in world and 'AgentObservationV1' in agent
assert 'deriveProjectStage' in world and 'deriveProjectStage' in render
assert 'SOCIAL_LOCATION_REQUEST' in agent
assert 'CHAIN_CONFIRMED' in world and 'SUBMITTED/INCLUDED' in render
assert 'Pixel AI Town' in (ROOT/'AGENTS.md').read_text(encoding='utf-8')

print(f'PASS: {len(REQUIRED)} documents, 2 DEMO JSON fixtures, hashes, scene bounds, cross-doc terms')
print('NOTE: this checks specification files only; no real app, Solidity, AI, wallet, or rendering implementation has been tested.')
