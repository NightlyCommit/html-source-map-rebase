import {TwingEnvironment, TwingLoaderFilesystem} from "twing";
import {posix, resolve} from "path";
import tape from "tape";
import {readFileSync} from "fs";
import {createRebaser} from "../src";

const warmUp = function () {
  let loader = new TwingLoaderFilesystem(resolve('test/fixtures'));

  return new TwingEnvironment(loader, {
    source_map: true
  });
};

tape('Rebaser', ({test}) => {
  test('should handle well-formed map', ({same, end}) => {
    const environment = warmUp();

    return environment.render('index.twig').then((html) => {
      const map = environment.getSourceMap();

      let rebaser = createRebaser(Buffer.from(map));

      return rebaser.rebase(Buffer.from(html))
        .then(({data}) => {
          const expectation = readFileSync(resolve('test/fixtures/wanted.html'));

          same(data.toString(), expectation.toString());

          end();
        });
    });
  });

  test('should emit rebase event', ({same, end}) => {
    const environment = warmUp();

    return environment.render('index.twig').then((html) => {
      const map = environment.getSourceMap();

      let rebaser = createRebaser(Buffer.from(map), {
        rebase: (_source, resolvedPath, done) => {
          done(posix.join('foo', resolvedPath));
        }
      });

      const rebasedPaths: Array<string> = [];
      const resolvedPaths: Array<string> = [];

      rebaser.on("rebase", (rebasedPath, resolvedPath) => {
        rebasedPaths.push(rebasedPath);
        resolvedPaths.push(resolvedPath);
      });

      return rebaser.rebase(Buffer.from(html))
        .then(() => {
          same(rebasedPaths.sort(), [
            'foo/test/fixtures/assets/foo.png',
            'foo/test/fixtures/assets/foo.png',
            'foo/test/fixtures/assets/foo.png',
            'foo/test/fixtures/partials/assets/foo-1.png',
            'foo/test/fixtures/partials/assets/foo-2.png'
          ].sort());

          same(resolvedPaths.sort(), [
            'test/fixtures/assets/foo.png',
            'test/fixtures/assets/foo.png',
            'test/fixtures/assets/foo.png',
            'test/fixtures/partials/assets/foo-1.png',
            'test/fixtures/partials/assets/foo-2.png'
          ].sort());

          end();
        });
    });
  });

  test('should ignore remote and absolute paths', ({same, end}) => {
    const environment = warmUp();

    return environment.render('remote-and-absolute/index.twig')
      .then((html) => {
        const map = environment.getSourceMap();

        let rebased: boolean = false;

        let rebaser = createRebaser(Buffer.from(map), {
          rebase: (_source, _resolvedPath, done) => {
            rebased = true;

            done();
          }
        });

        return rebaser.rebase(Buffer.from(html))
          .then(({data}) => {
            const expectation = readFileSync(resolve('test/fixtures/remote-and-absolute/wanted.html'));

            same(data.toString(), expectation.toString());
            same(rebased, false);

            end();
          });
      });
  });

  test('should handle region boundaries', ({same, end}) => {
    const environment = warmUp();

    return environment.render('boundaries/index.twig')
      .then((html) => {
        const map = environment.getSourceMap();

        let rebaser = createRebaser(Buffer.from(map));

        return rebaser.rebase(Buffer.from(html))
          .then(({data}) => {
            const expectation = readFileSync(resolve('test/fixtures/boundaries/wanted.html'));

            same(data.toString(), expectation.toString());
            end();
          });
      });
  });

  test('should handle one liners', ({same, end}) => {
    const environment = warmUp();

    return environment.render('one-liner/index.twig')
      .then((html) => {
        const map = environment.getSourceMap();

        let rebaser = createRebaser(Buffer.from(map));

        return rebaser.rebase(Buffer.from(html))
          .then(({data}) => {
            const expectation = readFileSync(resolve('test/fixtures/one-liner/wanted.html'));

            same(data.toString(), expectation.toString());
            end();
          });
      });
  });

  test('should support rebase callback', ({test}) => {
    const environment = warmUp();

    return environment.render('one-liner/index.twig')
      .then((html) => {
        const map = environment.getSourceMap();

        test('with done called with false', ({same, end}) => {
          const environment = warmUp();

          return environment.render('one-liner/index.twig')
            .then((html) => {
              let rebasedUrl: string | null = null;

              let rebaser = createRebaser(Buffer.from(map), {
                rebase: (_source, _resolvedPath, done) => {
                  done(false);
                }
              });

              rebaser.on('rebase', (url) => {
                rebasedUrl = url;
              });

              return rebaser.rebase(Buffer.from(html))
                .then(() => {
                  same(rebasedUrl, null);

                  end();
                });
            });
        });

        test('with done called with undefined', ({same, end}) => {
          const environment = warmUp();

          return environment.render('one-liner/index.twig')
            .then((html) => {
              let rebasedUrl: string | null = null;

              let rebaser = createRebaser(Buffer.from(map), {
                rebase: (_source, _resolvedPath, done) => {
                  done();
                }
              });

              rebaser.on('rebase', (url) => {
                rebasedUrl = url;
              });

              return rebaser.rebase(Buffer.from(html))
                .then(() => {
                  same(rebasedUrl, 'test/fixtures/assets/foo.png', 'rebasing happens with default logic');

                  end();
                });
            });
        });

        test('with done called with null', ({same, end}) => {
          const environment = warmUp();

          return environment.render('one-liner/index.twig')
            .then((html) => {
              let rebasedUrl: string | null = null;

              let rebaser = createRebaser(Buffer.from(map), {
                rebase: (_source, _resolvedPath, done) => {
                  done(null);
                }
              });

              rebaser.on('rebase', (url) => {
                rebasedUrl = url;
              });

              return rebaser.rebase(Buffer.from(html))
                .then(() => {
                  same(rebasedUrl, 'test/fixtures/assets/foo.png', 'rebasing happens with default logic');

                  end();
                });
            });
        });

        test('with done called with a value', ({same, end}) => {
          const environment = warmUp();

          return environment.render('one-liner/index.twig')
            .then((html) => {
              let rebasedUrl: string | null = null;

              let rebaser = createRebaser(Buffer.from(map), {
                rebase: (_source, _resolvedPath, done) => {
                  done('/foo');
                }
              });

              rebaser.on('rebase', (url) => {
                rebasedUrl = url;
              });

              return rebaser.rebase(Buffer.from(html))
                .then(() => {
                  same(rebasedUrl, '/foo', 'rebasing happen using the provided value');

                  end();
                });
            });
        });
      });
  });

  test('should map and html not belonging to each other', ({same, end}) => {
    const environment = warmUp();
    const otherEnvironment = warmUp();

    return Promise.all([
      environment.render('map-and-html-not-belonging-to-each-other/index.twig'),
      otherEnvironment.render('map-and-html-not-belonging-to-each-other/other.twig'),
    ]).then(([html]) => {
      const map = otherEnvironment.getSourceMap();

      let rebaser = createRebaser(Buffer.from(map));

      return rebaser.rebase(Buffer.from(html))
        .then(({data}) => {
          const expectation = readFileSync(resolve('test/fixtures/map-and-html-not-belonging-to-each-other/expectation.html'));

          same(data.toString(), expectation.toString());

          end();
        });
    });
  });

  test('throws an error on badly formed map', ({fail, pass, end}) => {
    const environment = warmUp();

    return environment.render('index.twig')
      .then((html) => {
      const map = Buffer.from('foo');

      let rebaser = createRebaser(Buffer.from(map));

      return rebaser.rebase(Buffer.from(html))
        .then(() => fail())
        .catch(pass)
        .finally(end);
    });
  });

  test('preserves the other parts of the document untouched', ({same, end}) => {
    const environment = warmUp();

    return environment.render('html/index.html')
      .then((html) => {
        const map = environment.getSourceMap();

        let rebaser = createRebaser(Buffer.from(map));

        return rebaser.rebase(Buffer.from(html))
          .then(({data}) => {
            const expectation = readFileSync(resolve('test/fixtures/html/expectation.html'));

            same(data.toString(), expectation.toString());

            end();
          });
      });
  });
});