import {TwingEnvironment, TwingLoaderFilesystem} from "twing";
import {resolve} from "path";

export const warmUp = function () {
  let loader = new TwingLoaderFilesystem(resolve('test/fixtures'));

  return new TwingEnvironment(loader, {
    source_map: true
  });
};