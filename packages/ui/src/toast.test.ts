import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Sonner itself, as the region's module sees it; the test watches what reaches it.
const sonner = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: sonner.toast, Toaster: () => null }));

/** Lets the dynamic import and the waiting promise settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('toast before and after the region', () => {
  beforeEach(() => {
    vi.resetModules();
    sonner.toast.mockClear();
    sonner.toast.success.mockClear();
    sonner.toast.error.mockClear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('a toast fired before the region mounts shows once it mounts', async () => {
    const { toast, regionMounted } = await import('./toast');
    toast.success('Lead saved for Sunita Meena.');
    await settle();
    expect(sonner.toast.success).not.toHaveBeenCalled();
    regionMounted();
    await settle();
    expect(sonner.toast.success).toHaveBeenCalledTimes(1);
    expect(sonner.toast.success).toHaveBeenCalledWith('Lead saved for Sunita Meena.', undefined);
  });

  it('shows at once while the region listens', async () => {
    const { toast, regionMounted } = await import('./toast');
    regionMounted();
    toast('Undone.');
    await settle();
    expect(sonner.toast).toHaveBeenCalledTimes(1);
  });

  it('waits again after the region leaves, and shows once it is back', async () => {
    const { toast, regionMounted, regionUnmounted } = await import('./toast');
    regionMounted();
    regionUnmounted();
    toast.error('We could not save that.');
    await settle();
    expect(sonner.toast.error).not.toHaveBeenCalled();
    regionMounted();
    await settle();
    expect(sonner.toast.error).toHaveBeenCalledTimes(1);
  });

  it('keeps a waiting toast when the region leaves before it ever mounted', async () => {
    const { toast, regionMounted, regionUnmounted } = await import('./toast');
    toast.success('Saved.');
    regionUnmounted();
    regionMounted();
    await settle();
    expect(sonner.toast.success).toHaveBeenCalledTimes(1);
  });
});
