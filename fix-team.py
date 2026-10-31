from pathlib import Path
p=Path('app/team-manager.tsx');s=p.read_text();s=s.replace('finally{setBusy(false)}}>', 'finally{setBusy(false)}}}>');p.write_text(s)
