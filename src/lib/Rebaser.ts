import RewritingStream from "parse5-html-rewriting-stream";
import {SourceMapConsumer} from "source-map";
import type {StartTagToken as StartTag} from "parse5-sax-parser";
import {EventEmitter} from "events";
import {parse, Url} from "url";
import {posix, isAbsolute, dirname, join} from "path";
import slash from "slash"
import {Readable, Writable} from "stream"

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

      const inputStream = new Readable({
        encoding: "utf-8"
      });

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

      inputStream
        .pipe(rewritingStream)
        .pipe(outputStream);

      const isRebasable = (url: Url): boolean => {
        return !isAbsolute(url.href) && (url.host === null) && ((url.hash === null) || (url.path !== null));
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

      const transformStartTag = (tag: StartTag) => {
        const processTag = (tag: StartTag) => {
          const attributes = tag.attrs;

          attributes.forEach((attribute) => {
            switch (attribute.name) {
              case 'href':
              case 'src':
                const url = parse(attribute.value);

                if (isRebasable(url)) {
                  const location = tag.sourceCodeLocation!;

                  let tagStartLine = location.startLine;
                  let tagStartColumn = location.startCol - 1;

                  let i = 0;
                  let tagRegion: Region | null = null;
                  let regions = getRegions();

                  while ((i < regions.length) && (tagRegion === null)) {
                    let region = regions[i];

                    if (
                      ((region.startLine < tagStartLine) || ((region.startLine === tagStartLine) && (region.startColumn <= tagStartColumn))) &&
                      (
                        (region.endLine === null) || (region.endLine > tagStartLine) ||
                        ((region.endLine === tagStartLine) && (region.endColumn === null || (region.endColumn >= tagStartColumn)))
                      )
                    ) {
                      tagRegion = region;
                    }

                    i++;
                  }

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
        };

        processTag(tag);
      }

      rewritingStream.on('startTag', (startTag) => {
        try {
          transformStartTag(startTag);

          rewritingStream.emitStartTag(startTag);
        } catch (error) {
          reject(error);
        }
      });

      inputStream.push(html);
      inputStream.push(null);
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
