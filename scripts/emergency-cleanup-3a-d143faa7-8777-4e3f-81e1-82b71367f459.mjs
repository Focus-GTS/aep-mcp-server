#!/usr/bin/env node
// AUTO-GENERATED. Pinned to one run. Accepts NO runtime ids.
// Order is deliberate: cancel a pending TTL BEFORE deleting the dataset.
const DATASET_ID = "6a81d24c670d055cbb873836";
const TTL_ID     = "SD-3de17d4e-5b01-4b56-9460-35a68a4b4629";
const PREFIX     = "mcpval-2026-08-16-d143faa7-8777-4e3f-81e1-82b71367f459";
console.log('Pinned Phase 3A cleanup:', { DATASET_ID, TTL_ID, PREFIX });
console.log('1) cancel TTL_ID if pending/executing  2) delete DATASET_ID');