"""LRU registry of loaded calibration runs.

Each (dataset_id, run_id) maps to a fully-loaded AppState. Loading is
expensive (~30s + memory for sparse matrices + Microsimulation), so we
cache a small number and evict in LRU order.
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict

from backend.services import runs as runs_service
from backend.state import AppState

logger = logging.getLogger(__name__)


class RunRegistry:
    """Bounded LRU cache of loaded AppStates, keyed by (dataset_id, run_id)."""

    def __init__(self, max_size: int = 3):
        self.max_size = max_size
        self._cache: OrderedDict[tuple[str, str], AppState] = OrderedDict()
        # Coarse lock: prevent two concurrent loads of the same run from
        # racing. Acceptable since loads are infrequent.
        self._lock = threading.Lock()

    def get(self, dataset_id: str, run_id: str) -> AppState:
        key = (dataset_id, run_id)
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
            dataset = runs_service.get_dataset(dataset_id)
            logger.info(
                "Loading run %s/%s (cache miss; %d/%d loaded)",
                dataset_id, run_id, len(self._cache), self.max_size,
            )
            from backend.services.loader import load_run  # lazy: heavy deps
            state = load_run(
                dataset.repo_id, dataset.repo_type, run_id, dataset_id=dataset_id,
            )
            self._cache[key] = state
            while len(self._cache) > self.max_size:
                evicted_key, _ = self._cache.popitem(last=False)
                logger.info("Evicted run %s/%s from cache", *evicted_key)
            return state

    def loaded_keys(self) -> list[tuple[str, str]]:
        with self._lock:
            return list(self._cache.keys())
