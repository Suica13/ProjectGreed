"""V05 balance policy: native Level pricing, tactical ranges, supply and ship sizes."""
import math,re
from mod_source import stat,section

LEVEL_TO_COST = 0.25
COST_STEP = 25

def apply_balance(p,data):
 level=stat(data,'unitLevel',0)
 if level<=0:raise ValueError('Missing native unitLevel: '+p['id'])
 p['stats']['cost']=max(COST_STEP,math.floor(level*LEVEL_TO_COST/COST_STEP+.5)*COST_STEP)
 p['costBalance']={'nativeLevel':level,'levelMultiplier':LEVEL_TO_COST,'published':p['stats']['cost']}
 p.setdefault('sourceStats',{}).update(unitLevel=level,balanceStatus='native-level')
 if p['stats'].get('ship'):
  width,height=(3,6) if p['id'] in ['PegasusClass','ZanzibarClass'] else (1,2) if p['id'] in ['GallopClass','MiniTrayClass'] else (2,3)
  p['stats']['footprint']={'width':width,'height':height}
 p['layers']=[layer for layer in p['layers'] if not re.match(r'Ring\d',layer.get('texture',''))]
 # Supply is passive. Keep its source radius and expose ordinary percentages.
 supply=next((s for s in p.get('skills',[]) if s['type']=='repair'),None)
 if supply or any(n.startswith('SupplyPoint') for n in p.get('sourceStats',{}).get('nativeSkills',[])):
  p['stats']['supplyAura']={'range':(supply or {}).get('range',2),'hpPercent':5,'enPercent':10}
 if p['stats'].get('supplyAura'):p['stats'].pop('autoRepair',None)
 p['skills']=[s for s in p.get('skills',[]) if s['type']!='repair']
 for m in p.get('mechanics',[]):
  if m['id']=='AutoRepair' and p['stats'].get('supplyAura'):m.update(name='自动修复已并入补给光环（无EN消耗）',status='adapted')
  if m['id'].startswith('SupplyPoint'):m.update(name='补给光环：范围内友军每回合恢复5%耐久、10%EN，不消耗EN',status='adapted')
 from weapon_policy import configure
 return configure(p,data)