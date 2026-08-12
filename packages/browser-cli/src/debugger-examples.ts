import { page, getCDPSession, createDebugger, console } from './debugger-examples-types.js'

// Example: List available scripts and set a breakpoint
async function listScriptsAndSetBreakpoint() {
  const cdp = await getCDPSession({ page })
  const dbg = createDebugger({ cdp })
  await dbg.enable()

  const scripts = await dbg.listScripts({ search: 'app' })
  console.log(scripts)

  if (scripts.length > 0) {
    const bpId = await dbg.setBreakpoint({ file: scripts[0].url, line: 100 })
    console.log('Breakpoint set:', bpId)
  }
}

// Example: Inspect state when paused at a breakpoint
async function inspectWhenPaused() {
  const cdp = await getCDPSession({ page })
  const dbg = createDebugger({ cdp })
  await dbg.enable()

  if (dbg.isPaused()) {
    const loc = await dbg.getLocation()
    console.log('Paused at:', loc.url, 'line', loc.lineNumber)
    console.log('Source:', loc.sourceContext)

    const vars = await dbg.inspectLocalVariables()
    console.log('Variables:', vars)

    const result = await dbg.evaluate({ expression: 'myVar.length' })
    console.log('myVar.length =', result.value)

    await dbg.stepOver()
  }
}

// Example: Step through code
async function stepThroughCode() {
  const cdp = await getCDPSession({ page })
  const dbg = createDebugger({ cdp })
  await dbg.enable()

  await dbg.setBreakpoint({ file: 'https://example.com/app.js', line: 42 })

  if (dbg.isPaused()) {
    await dbg.stepOver()
    await dbg.stepInto()
    await dbg.stepOut()
    await dbg.resume()
  }
}

// Example: Cleanup all breakpoints
async function cleanupBreakpoints() {
  const cdp = await getCDPSession({ page })
  const dbg = createDebugger({ cdp })

  const breakpoints = dbg.listBreakpoints()
  for (const bp of breakpoints) {
    await dbg.deleteBreakpoint({ breakpointId: bp.id })
  }
}

export { listScriptsAndSetBreakpoint, inspectWhenPaused, stepThroughCode, cleanupBreakpoints }
