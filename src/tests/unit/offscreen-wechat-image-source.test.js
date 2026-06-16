const fs = require('fs');
const path = require('path');
const vm = require('vm');

const offscreenSource = fs.readFileSync(
  path.join(__dirname, '../../offscreen/offscreen.js'),
  'utf8'
);

function createOffscreenSandbox() {
  class TestTurndownService {
    constructor(options = {}) {
      this.rules = [];
      this.options = options;
    }

    use() {}

    keep() {}

    addRule(name, rule) {
      this.rules.push({ name, rule });
    }

    turndown(html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
      const imageRule = this.rules.find((entry) => entry.name === 'images')?.rule;
      const parts = [];

      doc.body.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          parts.push(node.textContent);
          return;
        }
        if (imageRule?.filter(node, this.options) === true) {
          parts.push(imageRule.replacement.call(imageRule, '', node, this.options));
          return;
        }
        parts.push(node.textContent || '');
      });

      const options = this.options;
      return `${this.options.prepend?.(options) || ''}${parts.join('')}${this.options.append?.(options) || ''}`;
    }
  }

  TestTurndownService.prototype = {
    ...TestTurndownService.prototype,
    escape(value) {
      return value;
    },
    defaultEscape(value) {
      return value;
    }
  };

  const domParser = global.DOMParser;
  const textNode = global.Node;
  const sandbox = {
    console,
    DOMParser: domParser,
    Node: textNode,
    TurndownService: TestTurndownService,
    turndownPluginGfm: {
      highlightedCodeBlock: () => {},
      strikethrough: () => {},
      taskListItems: () => {}
    },
    document: {
      addEventListener: jest.fn(),
      createElement: jest.fn(() => ({
        innerHTML: '',
        querySelectorAll: () => []
      }))
    },
    browser: {
      runtime: {
        onMessage: {
          addListener: jest.fn()
        },
        sendMessage: jest.fn()
      }
    },
    chrome: {},
    defaultOptions: {},
    markSnipUrlUtils: require('../../shared/url-utils')
  };

  vm.createContext(sandbox);
  vm.runInContext(offscreenSource, sandbox, { filename: 'offscreen.js' });
  return sandbox;
}

describe('offscreen WeChat image source handling', () => {
  test('uses data-src for WeChat images whose src was rewritten for lazy loading', () => {
    const sandbox = createOffscreenSandbox();
    const realSrc = 'https://mmbiz.qpic.cn/mmbiz_jpg/example/640?wx_fmt=jpeg';
    const rewrittenSrc = 'https://mmbiz.qpic.cn/mmbiz_jpg/example/640?wx_fmt=jpeg&tp=webp&wxfrom=5&wx_lazy=1&wx_co=1';
    const result = sandbox.turndown(
      `<img alt="图片" data-src="${realSrc}" src="${rewrittenSrc}">`,
      {
        downloadImages: true,
        imageStyle: 'markdown',
        imageRefStyle: 'inlined',
        turndownEscape: false,
        tableFormatting: {},
        frontmatter: '',
        backmatter: '',
        title: 'WeChat Article',
        imagePlacement: 'sameFolder',
        imagePrefix: ''
      },
      {
        baseURI: 'https://mp.weixin.qq.com/s/example'
      }
    );

    expect(result.markdown).toBe('![图片](640.jpeg)');
    expect(result.imageList).toEqual({
      [realSrc]: '640.jpeg'
    });
  });
});
