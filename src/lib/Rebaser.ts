import RewritingStream from "parse5-html-rewriting-stream";
import {SourceMapConsumer, SourceMapGenerator} from "source-map";
import type {StartTagToken as StartTag, TextToken} from "parse5-sax-parser";
import {EventEmitter} from "events";
import {parse, Url} from "url";
import {posix, isAbsolute, dirname, join} from "path";
import slash from "slash"
import {Writable} from "stream"
import {Rebaser as CssRebaser} from "css-source-map-rebase";

export type Result = {
  data: Buffer,
  map: Buffer
};

/**
 * @param rebasedPath The rebased path of the asset. When `false`, the asset will not be rebased. When either `null` or `undefined`, the asset will be rebased using the default rebasing logic. When a `string`, the asset will be rebased to that string.
 */
export type RebaseHandlerCallback = (rebasedPath?: false | null | string) => void;

/**
 * @param source The source file where the asset was encountered.
 * @param resolvedPath The resolved path of the asset - i.e. the path of the asset relative to the source file.
 * @param done The callback function to invoke on completion.
 */
export type RebaseHandler = (source: string, resolvedPath: string, done: RebaseHandlerCallback) => void;

export type Options = {
  /**
   * The handler invoked to resolve the rebased path of the asset. Takes precedence over the default rebasing logic.
   */
  rebase?: RebaseHandler
};

type Region = {
  source: string;
  startLine: number;
  startColumn: number;
  endLine: number | null;
  endColumn: number | null;
};

/**
 * @param rebasedPath The rebased path of the rebased asset
 * @param resolvedPath The original path of the rebased asset
 */
export type RebaseEventListener = (rebasedPath: string, resolvedPath: string) => void;

export interface Rebaser {
  /**
   * Rebases the passed HTML markup assets reference.
   *
   * @param html The HTML markup whose assets need to be rebased.
   */
  rebase: (html: Buffer) => Promise<Result>;

  /**
   * Adds the listener to the end of the listeners array for the event "rebase".
   *
   * @param event
   * @param listener
   */
  on(event: "rebase", listener: RebaseEventListener): this;
}

/**
 * Creates and returns a Rebaser instance.
 *
 * @param map The source map that will be used to resolve the assets.
 * @param options
 */
export const createRebaser = (
  map: Buffer,
  options: Options = {}
): Rebaser => {
  const eventEmitter = new EventEmitter();

  const rebase: Rebaser["rebase"] = (
    html
  ) => {
    const rewritingStream = new RewritingStream();
    let {rebase} = options;
    let regions: Array<Region> | null = null;

    return new Promise((resolve, reject) => {
      let data: Buffer = Buffer.from('');

      const outputStream = new Writable({
        write(chunk: any, _encoding: BufferEncoding, callback: (error?: (Error | null)) => void) {
          data = Buffer.concat([data, chunk]);

          callback();
        }
      });

      outputStream.on('finish', () => {
        resolve({
          data,
          map
        });
      });

      rewritingStream.pipe(outputStream);

      const isRebasable = (url: Url): boolean => {
        return !isAbsolute(url.href) && (url.host === null) && ((url.hash === null) || (url.path !== null));
      };

      let queue: Promise<void> = Promise.resolve();

      const defer = (execution: () => Promise<void>) => {
        queue = queue
          .then(execution)
          .catch((error) => {
            reject(error);
          });
      };

      const getRegions = () => {
        if (!regions) {
          const foundRegions: Array<Region> = [];

          let sourceMapConsumer = new SourceMapConsumer(JSON.parse(map.toString()));

          let region: Region | null = null;
          let currentSource: string | null = null;

          sourceMapConsumer.eachMapping((mapping) => {
            let source = mapping.source;

            if (source !== currentSource) {
              // end the current region...
              if (region) {
                region.endLine = mapping.generatedLine;
                region.endColumn = mapping.generatedColumn;
              }

              //...and start a new one
              region = {
                source: source,
                startLine: mapping.generatedLine,
                startColumn: mapping.generatedColumn,
                endLine: null,
                endColumn: null
              };

              foundRegions.push(region);

              currentSource = source;
            }
          }, null);

          regions = foundRegions;
        }

        return regions;
      }

      const findRegion = (
        startLine: number,
        startColumn: number
      ): Region | null => {
        let i = 0;
        let result: Region | null = null;

        const regions = getRegions();
        const tagStartLine = startLine;
        const tagStartColumn = startColumn - 1;

        while ((i < regions.length) && (result === null)) {
          let region = regions[i];

          if (
            ((region.startLine < tagStartLine) || ((region.startLine === tagStartLine) && (region.startColumn <= tagStartColumn))) &&
            (
              (region.endLine === null) || (region.endLine > tagStartLine) ||
              ((region.endLine === tagStartLine) && (region.endColumn === null || (region.endColumn >= tagStartColumn)))
            )
          ) {
            result = region;
          }

          i++;
        }

        return result;
      }

      const transformText = (textToken: TextToken, rawHtml: string): Promise<void> => {
        if (currentStartTag?.tagName !== "style") {
          return Promise.resolve();
        }

        const {startLine, startCol, endLine} = textToken.sourceCodeLocation!;
        const numberOfLines = 1 + (endLine - startLine);
        const region = findRegion(startLine, startCol)!;

        const generator = new SourceMapGenerator();

        for (let generatedLine = 1; generatedLine <= numberOfLines; generatedLine++) {
          generator.addMapping({
            source: region.source,
            generated: {
              line: generatedLine,
              column: 0
            },
            original: {
              line: 1,
              column: 0
            }
          });
        }

        generator.setSourceContent(region.source, rawHtml);

        const cssRebaser = new CssRebaser({
          map: Buffer.from(generator.toString()),
          rebase
        });

        cssRebaser.on("rebase", (rebasedPath, resolvedPath) => {
          eventEmitter.emit('rebase', rebasedPath, resolvedPath);
        });

        return cssRebaser.rebase(Buffer.from(rawHtml))
          .then((result) => {
            const {css} = result;

            textToken.text = css.toString();
          });
      };

      const transformStartTag = (tag: StartTag) => {
        const processTag = (tag: StartTag) => {
          const attributes = tag.attrs;

          attributes.forEach((attribute) => {
            switch (attribute.name) {
              case 'href':
              case 'src':
                const url = parse(attribute.value);

                if (isRebasable(url)) {
                  const {startLine, startCol} = tag.sourceCodeLocation!;
                  const tagRegion = findRegion(startLine, startCol);
                  const {source} = tagRegion!;

                  const resolvedPath = posix.join(dirname(source), url.pathname!);

                  const done: RebaseHandlerCallback = (rebasedPath) => {
                    if (rebasedPath !== false) {
                      if (!rebasedPath) { // default rebasing
                        rebasedPath = resolvedPath;
                      }

                      attribute.value = slash(join('.', rebasedPath))!;

                      eventEmitter.emit('rebase', rebasedPath, resolvedPath);
                    }
                  };

                  if (!rebase) {
                    rebase = (_url, _source, done) => {
                      done();
                    };
                  }

                  rebase(source, resolvedPath, done);
                }

                break;
            }
          });
        }

        processTag(tag);
      }

      let currentStartTag: StartTag | null = null;

      rewritingStream.on('startTag', (startTag) => {
        defer(() => {
          currentStartTag = startTag;

          transformStartTag(startTag);
          rewritingStream.emitStartTag(startTag);

          return Promise.resolve();
        });
      });

      rewritingStream.on('text', (text, rawHtml) => {
        defer(() => {
          return transformText(text, rawHtml)
            .then(() => {
              rewritingStream.emitRaw(text.text);
            });
        });
      });

      rewritingStream.on("endTag", (endTag) => {
        defer(() => {
          currentStartTag = null;

          rewritingStream.emitEndTag(endTag);

          return Promise.resolve();
        });
      });

      for (const eventName of ['doctype', 'comment']) {
        rewritingStream.on(eventName, (_token, rawHtml) => {
          defer(() => {
            rewritingStream.emitRaw(rawHtml);

            return Promise.resolve();
          });
        });
      }

      rewritingStream.write(html.toString(), () => {
        queue.then(() => {
          rewritingStream.end()
        });
      });
    });
  };

  const rebaser: Rebaser = {
    rebase,
    on(event, listener) {
      eventEmitter.on(event, listener);

      return rebaser;
    }
  };

  return rebaser;
}
