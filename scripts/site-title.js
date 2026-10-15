// Override the theme's default home-tab title without changing upstream files.
hexo.extend.filter.register('before_generate', function () {
  const i18n = hexo.theme.i18n;
  for (const language of ['zh-CN', 'en', 'ja']) {
    i18n.set(language, Object.assign({}, i18n.get(language), {
      activeTitle: hexo.config.title
    }));
  }
});
// The theme embeds titles in single-quoted JavaScript. Use a JSON string so
// apostrophes in the blog name are safe when switching browser tabs.
hexo.extend.filter.register('after_render:html', function (html) {
  return html.replace(/activeTitle: '[^\n]*',/, function (line) {
    const value = line.slice("activeTitle: '".length, -2)
      .replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    return 'activeTitle: ' + JSON.stringify(value).replace(/</g, '\\u003c') + ',';
  });
});
