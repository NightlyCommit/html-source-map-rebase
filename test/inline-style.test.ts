import tape from "tape";
import {warmUp} from "./helpers";
import {createRebaser} from "../src";
import {readFileSync} from "fs";
import {resolve} from "path";

tape('Inline style', ({test}) => {
  test('inline style resources are rebased', ({same, end}) => {
    const environment = warmUp();

    return environment.render('inline-style/index.twig')
      .then((html) => {
        const map = environment.getSourceMap();

        let rebaser = createRebaser(Buffer.from(map));

        const rebasedPaths: Array<string> = [];

        rebaser.on("rebase", (rebasedPath, resolvedPath) => {
          rebasedPaths.push(rebasedPath);
        });

        return rebaser.rebase(Buffer.from(html))
          .then(({data}) => {
            const expectation = readFileSync(resolve('test/fixtures/inline-style/expectation.html'));

            same(data.toString(), expectation.toString());
            same(rebasedPaths, [
              'test/fixtures/assets/foo.png',
              'test/fixtures/assets/foo.png'
            ], '"rebase" event is emitted');

            end();
          });
      });
  });

  test('inline style resources are rebased according to the rebase option', ({same, end}) => {
    const environment = warmUp();

    return environment.render('inline-style/index.twig')
      .then((html) => {
        const map = environment.getSourceMap();

        let rebaser = createRebaser(Buffer.from(map), {
          rebase: (_source, _resolvedPath, done) => {
            done('foo');
          }
        });

        const rebasedPaths: Array<string> = [];

        rebaser.on("rebase", (rebasedPath, resolvedPath) => {
          rebasedPaths.push(rebasedPath);
        });

        return rebaser.rebase(Buffer.from(html))
          .then(({data}) => {
            const expectation = readFileSync(resolve('test/fixtures/inline-style/expectation-with-rebase-option.html'));

            same(data.toString(), expectation.toString());
            same(rebasedPaths, [
              'foo',
              'foo'
            ], '"rebase" event is emitted');

            end();
          });
      });
  });
});