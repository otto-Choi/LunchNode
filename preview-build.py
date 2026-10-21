from pathlib import Path
import subprocess
subprocess.run(['node','scripts/build-preview.cjs'],cwd=Path(__file__).parent,check=True)
