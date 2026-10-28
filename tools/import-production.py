"""Import factory prices, batch outputs and original times. Original MOD stays read-only."""
import json,re
from collections import defaultdict
from pathlib import Path
from mod_source import ROOT,MOD,ASSETS,parse,load,section,number
from native_weapon_layout import conditions
PROJECT=Path(__file__).resolve().parents[1]

def source_sections(file):
    data=parse(file); current=None
    for line in file.read_text(encoding='utf-8-sig').splitlines():
        line=line.strip()
        if line.startswith('[') and line.endswith(']'):current=data[line[1:-1]]
        elif current is not None:
            match=re.match(r'@define\s+(\w+)\s*=\s*(.*)',line)
            if match:current['define.'+match[1]]=match[2]
    return data

def factory_offers():
    offers=defaultdict(list)
    base=ROOT/'Units/Buildings/Factory/UnitList'
    template=parse(base/'Mod/UnitTemplate.ini')
    for file in sorted(base.glob('*/Units/**/*')):
        if not file.is_file() or file.suffix.lower() not in ('.ini','.gw'):continue
        own=source_sections(file);data={**template,**own}
        for name in own:
            if not name.startswith('action_Produce_'):continue
            d=section(data,name);outputs=[];delays=[]
            def visit(key,stack=()):
                if key in stack:raise ValueError('Factory queue cycle: '+key)
                step=section(data,key);delays.append(number(step.get('buildSpeed',0)))
                for match in re.finditer(r'(\w+)\*(\d+)(?:\(([^)]*)\))?',step.get('produceUnits','')):
                    equipment=re.search(r'\bEquipmentIndex:(\d+)',match[3] or '')
                    outputs.append({'unitId':match[1],'quantity':int(match[2]),'equipmentIndex':int(equipment[1]) if equipment else 0,'resources':match[3] or ''})
                for field in ('alsoQueueAction','alsoTriggerAction'):
                    for child in step.get(field,'').split(','):
                        target=next((prefix+child.strip() for prefix in ('hiddenAction_','action_') if prefix+child.strip() in data),None)
                        if target:visit(target,(*stack,key))
            visit(name)
            pairs={(o['unitId'],o['equipmentIndex']) for o in outputs}
            if not pairs:raise ValueError('Missing outputs: '+name)
            unit_id,index=outputs[0]['unitId'],outputs[0]['equipmentIndex']
            offers[(unit_id,index)].append({'money':int(d['define.Money']),'supplies':int(d['define.Resource']),'quantity':sum(o['quantity'] for o in outputs),'equipmentIndex':index,'source':{'file':str(file.relative_to(MOD)).replace('\\','/'),'action':name,'buildSeconds':delays[0],'queueSeconds':sum(delays[1:]),'outputs':outputs}})
    return offers

def tech_costs():
    result={}
    for faction in ('EFSF','ZEON'):
        file=ROOT/f'Units/TechTree/Tech/Faction/{faction}_0079/TechList_{faction}_0079.ini'
        for key,value in parse(file).items():
            if not key.startswith('hiddenAction_') or not key.endswith('_Awake'):continue
            values=dict(re.findall(r'\b\S*?_(Time|Money|Resource|TechPoint)\s*=\s*(\d+)',value.get('setUnitMemory','')))
            if values:result[key[13:-6]]={'money':int(values['Money'])*2,'supplies':int(values['Resource'])*2,'sourceCosts':{'money':int(values['Money']),'supplies':int(values['Resource']),'points':int(values['TechPoint']),'researchSeconds':int(values['Time']),'file':str(file.relative_to(MOD)).replace('\\','/'),'action':key}}
    return result

def main():
    offers=factory_offers();result={};unavailable=[]
    registry=json.loads((ASSETS/'unit-catalog.json').read_text(encoding='utf8'))
    for reference in registry['units']:
        p=json.loads((ASSETS/reference).read_text(encoding='utf8'));native=load(MOD/p['source']);indices={}
        for key,weapon in p['weapons'].items():
            found={int(m[1]) for condition in conditions(native,weapon) for m in re.finditer(r'\bEquipmentIndex\s*==\s*(\d+)',condition)}
            if len(found)==1:indices[key]=next(iter(found))
        for kit in p['weaponKits']:
            values={indices[key] for key in kit['weapons'] if key in indices}
            if len(values)>1:raise ValueError('Ambiguous equipment: '+p['id']+'/'+kit['id'])
            index=next(iter(values),0);candidates=offers.get((p['id'],index),[])
            if not candidates and len(p['weaponKits'])==1:
                candidates=[o for (unit,_),rows in offers.items() if unit==p['id'] for o in rows]
            normal=[o for o in candidates if '_Fast' not in o['source']['action'] and 'Fast' not in Path(o['source']['file']).stem];candidates=normal or candidates
            model_id=p['id']+'__'+kit['id']
            if not candidates:unavailable.append(model_id);continue
            prices={(o['money'],o['supplies'],o['quantity']) for o in candidates}
            if len(prices)!=1:raise ValueError('Conflicting prices: '+model_id+': '+str(prices))
            selected=max(candidates,key=lambda o:o['source']['buildSeconds'])
            result[model_id]={'output':{'unitId':p['id'],'kitId':kit['id'],'quantity':selected['quantity']},'unitId':p['id'],'faction':next(tag for tag in p['tags'] if tag in ('EFSF','ZEON')),**({'availableFactions':p['availableFactions']} if p.get('availableFactions') else {}),**selected,'sourceAlternatives':[o['source'] for o in candidates if o!=selected]}
    units={}
    for model_id,offer in result.items():
        unit=offer['unitId'];previous=units.get(unit)
        if previous is None or (offer['money']+offer['supplies'],offer['money'],model_id)<(result[previous]['money']+result[previous]['supplies'],result[previous]['money'],previous):units[unit]=model_id
    for unit,base_id in units.items():
        base=result[base_id]
        if any(o['money']<base['money'] or o['supplies']<base['supplies'] for o in result.values() if o['unitId']==unit):raise ValueError('No cheapest base in both currencies: '+unit)
    (PROJECT/'shared/production-catalog.json').write_text(json.dumps({'schemaVersion':1,'timeEnabled':False,'equipmentPolicy':'uniform-kit','baseModels':units,'offers':result,'unavailable':unavailable},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    costs=tech_costs();file=PROJECT/'shared/development-tree.json';tree=json.loads(file.read_text(encoding='utf8'))
    for nodes in tree.values():
        for node in nodes:
            if node['id'] not in costs:continue # Keep developer-created technology nodes intact.
            node.update(costs[node['id']])
    file.write_text(json.dumps(tree,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(f'Imported {len(result)} kit offers; {len(unavailable)} unavailable; {sum(map(len,tree.values()))} technologies')
    print('Unavailable: '+', '.join(unavailable))

if __name__=='__main__':main()
