let activeAdapter = null;

export const ConnectionManager = {
  setAdapter(adapter) {
    activeAdapter = adapter;
  },

  getAdapter() {
    if (!activeAdapter) {
      throw new Error(
        "No database adapter configured. Call ConnectionManager.setAdapter() before using models."
      );
    }
    return activeAdapter;
  },

  reset() {
    activeAdapter = null;
  },
};
