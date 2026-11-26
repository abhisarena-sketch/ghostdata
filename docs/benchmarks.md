# Benchmarks

Measured with `npm run bench` on 2026-11-26.

- Machine: Intel(R) Xeon(R) Processor @ 2.10GHz, 4 logical CPUs, 16087.2 MB RAM, linux 6.18.44-fc-v880
- Node.js v22.23.5
- Dataset: `employees` (14 fields: nested address, an array, a nullable self-reference, unique email and id) plus `departments` (1 per 50 employees), with two foreign keys. Seed 42.

Times are wall-clock milliseconds for one run, so expect some variation. Memory is the heap growth after generation, and the peak resident set size of the whole process so far (sizes run smallest first, so each row includes the earlier ones). Export times are for the employees collection serialised in memory. The CLI streams large outputs to disk instead.

| Employees | Records total | Generate (ms) | Records/s | Heap after generate (MB) | Peak RSS (MB) | Validate + integrity + safety scan (ms) | JSON export (ms / MB) | JSONL export (ms) | CSV export (ms / MB) | Inspect (ms) | Mask (ms) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 1,020 | 51 | 20,023 | 7.4 | 82.3 | 34 | 3.1 / 0.5 | 2.0 | 10 / 0.2 | 55 | 71 |
| 10,000 | 10,200 | 177 | 57,498 | 23.1 | 150.2 | 134 | 25 / 5.3 | 14 | 67 / 1.9 | 143 | 401 |
| 100,000 | 102,000 | 1,580 | 64,561 | 135.3 | 634.4 | 1,539 | 212 / 53.1 | 163 | 617 / 19.6 | 3,389 | 3,902 |

Reproduce with `npm run bench`, or choose sizes with `BENCH_SIZES=1000,50000 npm run bench`.
