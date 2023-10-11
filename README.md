# html-source-map-rebase

[![NPM version][npm-image]][npm-url] [![Build Status][travis-image]][travis-url] [![Coverage percentage][coveralls-image]][coveralls-url]

Rebase your HTML assets relatively to the source file they were imported from.

## Installation

```bash
npm install html-source-map-rebase
```

## Example

Consider the following Twig sources:

index.twig

``` html
<img src="./foo.png">

{% include "partials/bar.twig" %}
```

partials/bar.twig

``` html
<img src="../bar.png">
<style>
    .foo {
        background-image: url("../bar.png");
    }
</style>
```

By rebasing the assets relatively to the file they were imported from, the resulting HTML would be:

``` html
<img src="foo.png">
<img src="bar.png">
<style>
    .foo {
        background-image: url("bar.png");
    }
</style>
```

Yes, you read it well: it also rebases resources referenced by inline styles.

## How it works

html-source-map-rebase uses the mapping provided by source maps to resolve the original file the assets where imported from. That's why it *needs* a source map to perform its magic. Any tool able to generate a source map from a source file is appropriate. Here is how one could use [Twing](https://www.npmjs.com/package/twing) and html-source-map-rebase together to render an HTML document and rebase its assets.

``` javascript
import {TwingEnvironment, TwingLoaderFilesystem} from "twing";
import {createRebaser} from "html-source-map-rebase";

const loader = new TwingLoaderFilesystem('src');
const environment = new TwingEnvironment(loader, {
  source_map: true
});

return environment.render('index.twig')
    .then((html) => {
        const map = environment.getSourceMap();
        const rebaser = createRebaser(Buffer.from(map));
    
        return rebaser.rebase(html);
    })
    .then((result) => {
        // result.data contains the HTML markup with rebased assets
        // result.map contains the source map
    });
```

## API

Read the [documentation](https://nightlycommit.github.io/html-source-map-rebase) for more information.

## Contributing

* Fork the main repository
* Code
* Implement tests using [tape](https://www.npmjs.com/package/tape)
* Issue a pull request keeping in mind that all pull requests must reference an issue in the issue queue

## License

Apache-2.0 © [Eric MORAND]()

[npm-image]: https://badge.fury.io/js/html-source-map-rebase.svg
[npm-url]: https://npmjs.org/package/html-source-map-rebase
[travis-image]: https://travis-ci.org/ericmorand/html-source-map-rebase.svg?branch=master
[travis-url]: https://travis-ci.org/ericmorand/html-source-map-rebase
[coveralls-image]: https://coveralls.io/repos/github/ericmorand/html-source-map-rebase/badge.svg
[coveralls-url]: https://coveralls.io/github/ericmorand/html-source-map-rebase