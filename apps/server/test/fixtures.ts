export const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Example Blog</title>
  <link>https://blog.example.com/</link>
  <description>An example feed</description>
  <item>
    <title>First &amp; foremost</title>
    <link>https://blog.example.com/first</link>
    <guid isPermaLink="false">post-1</guid>
    <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Short summary</p>]]></description>
    <content:encoded><![CDATA[<p>Full <b>content</b> <img src="/img/a.png"><script>alert(1)</script></p>]]></content:encoded>
    <dc:creator>Alice</dc:creator>
    <category>News</category>
    <category>Tech</category>
    <media:thumbnail url="https://blog.example.com/thumb.jpg"/>
  </item>
  <item>
    <title>Second post</title>
    <link>/second</link>
    <pubDate>Tue, 02 Jan 2024 10:00:00 CEST</pubDate>
    <description>Plain description</description>
    <enclosure url="https://blog.example.com/cover.png" type="image/png" length="10"/>
  </item>
</channel>
</rss>`;

export const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Example</title>
  <id>urn:uuid:feed</id>
  <updated>2024-01-03T00:00:00Z</updated>
  <link href="https://atom.example.com/"/>
  <entry>
    <title>Atom entry</title>
    <id>urn:uuid:entry-1</id>
    <link rel="self" href="https://atom.example.com/self"/>
    <link rel="alternate" href="https://atom.example.com/entry-1"/>
    <published>2024-01-02T08:00:00Z</published>
    <updated>2024-01-03T08:00:00Z</updated>
    <summary>Atom summary</summary>
    <content type="html">&lt;p&gt;Atom content&lt;/p&gt;</content>
    <author><name>Bob</name></author>
    <category term="science" label="Science"/>
  </entry>
</feed>`;

export const RDF_FEED = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://rdf.example.com/">
    <title>RDF Example</title><link>https://rdf.example.com/</link><description>d</description>
  </channel>
  <item rdf:about="https://rdf.example.com/1">
    <title>RDF item</title>
    <link>https://rdf.example.com/1</link>
    <description>RDF description</description>
    <dc:date>2024-01-01T00:00:00Z</dc:date>
    <dc:creator>Carol</dc:creator>
  </item>
</rdf:RDF>`;

export const JSON_FEED = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'JSON Feed Example',
  items: [
    {
      id: 'jf-1',
      url: 'https://json.example.com/1',
      title: 'JSON Feed item',
      content_html: '<p>JSON content</p>',
      date_published: '2024-01-05T00:00:00Z',
      authors: [{ name: 'Dana' }],
      tags: ['a', 'b'],
      image: 'https://json.example.com/i.png',
    },
  ],
});

export const API_JSON = JSON.stringify({
  data: {
    posts: [
      {
        slug: 'hello',
        headline: 'Hello API',
        permalink: 'https://api.example.com/posts/hello',
        body: '<p>API body</p>',
        created: '05/01/2024 14:30',
        meta: { writer: 'Eve', labels: [{ name: 'x' }, { name: 'y' }] },
      },
      {
        slug: 'bye',
        headline: 'Bye API',
        permalink: 'https://api.example.com/posts/bye',
        body: '<p>Bye body</p>',
        created: '06/01/2024 09:00',
        meta: { writer: 'Eve', labels: [] },
      },
    ],
  },
});

export const BLOG_HTML = `<!doctype html>
<html><head>
  <title>Scraped blog</title>
  <link rel="alternate" type="application/rss+xml" href="/feed.xml">
</head><body>
  <main>
    <article class="post">
      <h2 class="title"><a href="/posts/one">Post one</a></h2>
      <time datetime="2024-02-01T10:00:00Z">Feb 1</time>
      <p class="excerpt">Excerpt one</p>
      <img src="/images/one.jpg">
      <span class="tag">alpha</span><span class="tag">beta</span>
    </article>
    <article class="post">
      <h2 class="title"><a href="/posts/two">Post two</a></h2>
      <time datetime="2024-02-02T10:00:00Z">Feb 2</time>
      <p class="excerpt">Excerpt two</p>
    </article>
  </main>
</body></html>`;

export const ARTICLE_HTML = `<!doctype html>
<html><head><title>Article</title></head><body>
  <nav>Menu</nav>
  <article>
    <h1>Full article</h1>
    <div class="article-body">
      <p>${'This is the complete article text with plenty of words. '.repeat(30)}</p>
      <p>${'Another paragraph that makes readability happy. '.repeat(30)}</p>
    </div>
  </article>
  <footer>Footer</footer>
</body></html>`;
