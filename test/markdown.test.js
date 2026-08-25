import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 从 client.js 提取 #region markdown-renderer 段（纯函数、无 DOM 依赖），
// 保证被测代码与线上 bundle 逐字节同源。
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const begin = source.indexOf('// #region markdown-renderer')
const end = source.indexOf('// #endregion', begin)
assert.ok(begin !== -1 && end !== -1, 'markdown-renderer region 标记缺失')
const region = source.slice(begin, end)
const factory = new Function(`${region}\nreturn atlasMarkdown`)
const md = factory()

test('行内语法：code/粗体/斜体/删除线，全量 HTML 逃逸', () => {
  assert.equal(md('`x < 1`'), '<p><code>x &lt; 1</code></p>')
  assert.equal(md('**bold**'), '<p><strong>bold</strong></p>')
  assert.equal(md('~~gone~~'), '<p><del>gone</del></p>')
  assert.equal(md('a *em* b'), '<p>a <em>em</em> b</p>')
  assert.equal(md('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  assert.equal(md('**a** *b* `c` ~~d~~'), '<p><strong>a</strong> <em>b</em> <code>c</code> <del>d</del></p>')
})

test('标题层级：# → h1、## → h2、### → h3（不再合并）', () => {
  assert.equal(md('# T'), '<h1>T</h1>')
  assert.equal(md('## T'), '<h2>T</h2>')
  assert.equal(md('### T'), '<h3>T</h3>')
})

test('列表：无序与有序分开成块', () => {
  assert.equal(md('- a\n- b'), '<ul><li>a</li><li>b</li></ul>')
  assert.equal(md('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>')
  assert.equal(md('* a\n+ b'), '<ul><li>a</li><li>b</li></ul>')
})

test('GFM 表格：表头+分隔行+表体', () => {
  assert.equal(
    md('| a | b |\n| --- | :-: |\n| 1 | 2 |'),
    '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
  )
  assert.equal(md('| x |\n| not-delimiter |'), '<p>| x |<br>| not-delimiter |</p>')
})

test('代码块：围栏内容不解析行内语法、去语言行', () => {
  assert.equal(md('```js\nlet a = 1 ** 2\n```'), '<pre><code>let a = 1 ** 2\n</code></pre>')
  assert.equal(md('```\n<b>&amp;</b>\n```'), '<pre><code>&lt;b&gt;&amp;amp;&lt;/b&gt;\n</code></pre>')
})

test('段落：<br> 连接、空行分段、表格后接正文', () => {
  assert.equal(md('l1\nl2'), '<p>l1<br>l2</p>')
  assert.equal(md('a\n\nb'), '<p>a</p><p>b</p>')
  assert.equal(
    md('| h |\n| --- |\n| c |\ntail'),
    '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table><p>tail</p>',
  )
})

test('解析器始终前进：孤立标记行被消费', () => {
  assert.equal(md('+ '), '<p>+ </p>')
})

test('LRU 缓存：同输入命中同输出', () => {
  assert.equal(md('cache **hit**'), md('cache **hit**'))
})

test('空与极限输入', () => {
  assert.equal(md(''), '')
  assert.equal(md(null), '')
  assert.equal(md('\n\n\n'), '')
})

// GPT 评审 P0-1（2026-08-21）：XSS 攻击面锁定——渲染器走 innerHTML，此处穷举
// 已知注入形态钉死逃逸行为；未来加 link/image/html 语法时这里的用例必须继续全绿。
test('XSS 锁定：事件属性/嵌套标签/代码包壳/强调包壳/表格注入', () => {
  // 事件处理器属性（无 link/image 语法时最可能的破口）
  assert.equal(md('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>')
  // 嵌套开标签（先逃逸再剥壳，无复活路径）
  assert.equal(md('<<script>script>alert(1)<</script>/script>'), '<p>&lt;&lt;script&gt;script&gt;alert(1)&lt;&lt;/script&gt;/script&gt;</p>')
  // 行内代码包壳：内容必须逃逸，代码标记本身不能被内容吞掉
  assert.equal(md('`<script>alert(1)</script>`'), '<p><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></p>')
  // 强调包壳：标签在强调内不产生元素
  assert.equal(md('**<b onmouseover=alert(1)>x</b>**'), '<p><strong>&lt;b onmouseover=alert(1)&gt;x&lt;/b&gt;</strong></p>')
  // 表格单元格注入
  assert.equal(md('| a |\n| --- |\n| <img src=x onerror=alert(2)> |'), '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>&lt;img src=x onerror=alert(2)&gt;</td></tr></tbody></table>')
  // js: 伪协议（当前无 link 语法；锁定纯文本形态，防止未来加 link 时漏防）
  assert.equal(md('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>')
})
