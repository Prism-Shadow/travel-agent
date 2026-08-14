export async function resolvePersistentInstallId(loadInstallId: () => Promise<string>): Promise<string | null> {
  try {
    const installId = await loadInstallId()
    return installId || null
  } catch {
    return null
  }
}
