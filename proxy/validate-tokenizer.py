# Second reference: HuggingFace `tokenizers` (the Rust original), compared against our TS impl.
#   uv run --with tokenizers validate-tokenizer.py cases.json
# Reads a JSON array of strings, writes a JSON array of id-arrays to stdout.
import json, sys
from tokenizers import Tokenizer
tok = Tokenizer.from_file(sys.argv[2] if len(sys.argv) > 2 else "tokenizer/tokenizer.json")
cases = json.load(open(sys.argv[1]))
json.dump([tok.encode(c, add_special_tokens=False).ids for c in cases], sys.stdout)
