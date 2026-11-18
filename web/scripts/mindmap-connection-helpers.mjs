import assert from 'node:assert/strict'

// Check before any expand/collapse action can accidentally initialize the edges.
export async function checkMindmapConnections(page) {
  await page.waitForFunction(() => {
    const nodes = document.querySelectorAll('.mindmap-node')
    return nodes.length > 0 && document.querySelectorAll('.mindmap-connections path').length === nodes.length - 1
  }, { timeout: 5000 })
  const failures = await page.evaluate(() => [...document.querySelectorAll('.mindmap-connections path')].flatMap(edge => {
    const path = edge.dataset.edge
    const parent = document.querySelector(`[data-node-path="${path.slice(0, path.lastIndexOf('.'))}"]`).getBoundingClientRect()
    const child = document.querySelector(`[data-node-path="${path}"]`).getBoundingClientRect()
    const matrix = edge.getScreenCTM()
    const start = edge.getPointAtLength(0).matrixTransform(matrix)
    const end = edge.getPointAtLength(edge.getTotalLength()).matrixTransform(matrix)
    const style = getComputedStyle(edge)
    const aligned = Math.abs(start.x - parent.right) < 2 && Math.abs(start.y - parent.top - parent.height / 2) < 2
      && Math.abs(end.x - child.left) < 2 && Math.abs(end.y - child.top - child.height / 2) < 2
    return aligned && style.stroke !== 'none' && parseFloat(style.strokeWidth) > 0 && parseFloat(style.opacity) > 0 ? [] : [path]
  }))
  assert.deepEqual(failures, [], 'visible connections attach to both node boundaries')
}
