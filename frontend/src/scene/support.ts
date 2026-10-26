// Kept apart from the engine so the page can test for WebGL without loading three.js.

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext(); // give the test context back
    return true;
  } catch {
    return false;
  }
}
