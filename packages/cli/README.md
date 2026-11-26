# @workfonic/dataghost-cli

The `dataghost` command: inspect datasets, generate synthetic data, mask or preserve real data, validate and convert between JSON, JSONL and CSV. Everything runs locally.

```bash
npx dataghost init
npx dataghost inspect customers.json
npx dataghost generate customers.json --count 5000 --format csv --seed 7
npx dataghost generate customers.json --mode mask
npx dataghost validate dataghost-output/customers.synthetic.json
npx dataghost export data.json --format jsonl
```

Outputs stay inside the current directory unless `--allow-outside-cwd`, existing files are not overwritten without `--force`, and input files are never overwritten.

Docs: [CLI reference](https://github.com/abhisarena-sketch/ghostdata/blob/main/docs/cli.md). License: MIT.
