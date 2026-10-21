#!/usr/bin/env python3
"""Offline, bounded public/synthetic corpus scoring. Never writes templates.

A candidate threshold is an engineering measurement, not release qualification.
The independent evaluator owns holdout design, error bounds and acceptance.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time
from worker import Encoder, MAX_AUDIO, MODEL, Rejected, deny_network, exact_object

def wilson_upper(errors, count):
    if count == 0: return None
    z = 1.959963984540054
    p = errors / count
    return (p + z*z/(2*count) + z*math.sqrt(p*(1-p)/count + z*z/(4*count*count))) / (1+z*z/count)

def score_partition(rows, maximum=2000):
    pairs=[]
    for index,a in enumerate(rows):
        for b in rows[index+1:]:
            if len(pairs)>=maximum: return pairs
            score=max(-1.0,min(1.0,sum(x*y for x,y in zip(a['vector'],b['vector']))))
            pairs.append((a['speaker']==b['speaker'],score))
    return pairs

def summarize(pairs, threshold):
    same=[v for label,v in pairs if label];different=[v for label,v in pairs if not label]
    fa=sum(score>=threshold for score in different);fr=sum(score<threshold for score in same)
    return {'sameSpeakerPairs':len(same),'differentSpeakerPairs':len(different),
            'falseMatches':fa,'falseRejects':fr,'falseMatchRate':fa/len(different) if different else None,
            'falseRejectRate':fr/len(same) if same else None,'nominalWilson95FalseMatchUpper':wilson_upper(fa,len(different))}

def main():
    p=argparse.ArgumentParser();p.add_argument('--model-dir',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--permit-licensed-public',action='store_true');args=p.parse_args()
    if not args.permit_licensed_public:raise Rejected('explicit_public_corpus_scope_required')
    if args.manifest.stat().st_size>200_000:raise Rejected('manifest_too_large')
    raw=args.manifest.read_bytes();manifest=json.loads(raw)
    exact_object(manifest,['schemaVersion','provenance','license','fixtureKind','files'])
    if manifest['schemaVersion']!=1 or manifest['fixtureKind'] not in ('licensed_public','synthetic') or not isinstance(manifest['provenance'],str) or not manifest['provenance'].startswith('https://') or not isinstance(manifest['license'],str) or not manifest['license'].strip():raise Rejected('invalid_manifest')
    files=manifest['files']
    if not isinstance(files,list) or not 4<=len(files)<=200:raise Rejected('corpus_bound_exceeded')
    sys.addaudithook(deny_network);encoder=Encoder(args.model_dir)
    rows=[];total=0;seen=set();speaker_splits={};started=time.monotonic()
    for entry in files:
        exact_object(entry,['path','sha256','speaker','split','mimeType'])
        path=Path(entry['path'])
        if not path.is_absolute() or path.is_symlink() or not path.is_file() or path in seen or entry['split'] not in ('calibration','holdout') or not isinstance(entry['speaker'],str) or not entry['speaker'] or len(entry['speaker'])>100:raise Rejected('invalid_fixture')
        seen.add(path);size=path.stat().st_size;total+=size
        if not 0<size<=MAX_AUDIO or total>100_000_000 or time.monotonic()-started>120:raise Rejected('corpus_bound_exceeded')
        if entry['speaker'] in speaker_splits and speaker_splits[entry['speaker']]!=entry['split']:raise Rejected('speaker_leakage_between_splits')
        speaker_splits[entry['speaker']]=entry['split']
        audio=bytearray(path.read_bytes())
        try:
            if hashlib.sha256(audio).hexdigest()!=entry['sha256']:raise Rejected('fixture_digest_mismatch')
            rows.append({'speaker':entry['speaker'],'split':entry['split'],'vector':encoder.extract(audio,entry['mimeType'])})
        finally:audio[:]=b'\0'*len(audio)
    calibration=score_partition([r for r in rows if r['split']=='calibration'])
    holdout=score_partition([r for r in rows if r['split']=='holdout'])
    nonmatch=[s for label,s in calibration if not label]
    if not nonmatch or not any(label for label,_ in calibration) or not any(label for label,_ in holdout) or not any(not label for label,_ in holdout):raise Rejected('same_and_different_speaker_pairs_required_in_both_splits')
    # Candidate just above the maximum calibration impostor score. Never install
    # it automatically; small/public speaker sets cannot establish target FAR.
    threshold=min(1.0,max(nonmatch)+1e-6)
    report={'kind':'bounded_public_encoder_calibration','modelDigest':MODEL['weightsSha256'],'manifestSha256':hashlib.sha256(raw).hexdigest(),
            'fixtureKind':manifest['fixtureKind'],'provenance':manifest['provenance'],'license':manifest['license'],
            'files':len(rows),'speakers':len(speaker_splits),'candidateThreshold':threshold,
            'calibration':summarize(calibration,threshold),'holdout':summarize(holdout,threshold),
            'elapsedSeconds':time.monotonic()-started,'recognitionAccuracyQualified':False,'inspectionQualified':False,
            'limits':['Pairs sharing speakers/utterances are dependent; nominal Wilson bound is descriptive, not a certified population bound.',
                      'Requires independent target-population/device/language holdout and approved FAR/FRR acceptance before installing a policy.',
                      'This scores encoder self-match only. It does not qualify challenge, overlap, synthetic audio or physical replay inspection.']}
    for row in rows:row['vector'][:]=[0.0]*len(row['vector'])
    print(json.dumps(report))
if __name__=='__main__':
    try:main()
    except Exception:print(json.dumps({'error':'voice_qualification_not_completed'}),file=sys.stderr);sys.exit(1)
