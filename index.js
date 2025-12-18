/**
 * import cjs in the browser
 *
 * How to make the require function behavior synchronous?
 * Facts:
 * 1. we know the entry module first
 * 2. entry module must run to reveal what is required
 * 3. loading modules is async
 * 4. we only have exports once the module runs
 *
 * but who says it must only run once?
 *
 * Phase one
 * - shim require globally
 * - return polite proxies
 * - collect specifiers
 * - discard the module
 *
 * With that, go down the tree recursively, catch and ignore errors
 *
 * Phase two
 * - start from modules without dependencies
 * - import them under a working require shim
 * - save their exports
 * - go up the tree until done
 *
 * Cycles might hurt
 *
 */

(function () {
  const { create, defineProperty, defineProperties } = Object;

  const politeProxy = () =>
    new Proxy(function () {}, {
      has: () => true,
      get: () => politeProxy(),
    });

  const resolve = (specifier) => {
    // FIXME: I don't want to do this right now for a PoC
    // leaving this as an exercise for the reader
    return specifier;
  };

  const gimmeRealm = () => {
    const i = document.createElement("iframe");
    // messing with the document could potentially be avoided, I don't remember
    document.body.append(iframe);
    const w = i.contentWindow;
    return {
      global: w.globalThis,
      // makes me think workers would be great for this because they do importScripts
      // but the communication would end up being async anyway
      importScript(location) {
        const idoc = i.contentDocument;
        const scr = idoc.createElement("script");
        // reminds me how I would do scr instead of src in HTML as a kid :D
        scr.src = location;
        i.contentDocument.head.append(scr);
      },
      done: new Promise((resolve) => {
        const finalize = () => {
          resolve(); // yes, potentially twices
          document.body.removeChild(i);
        };
        // umm... make sure script is added in a way that onload waits for it
        i.contentWindow.onload(finalize);
        i.contentWindow.onerror(finalize);
      }),
    };
  };
  const recordRequires = (parent, edgesFound) => (specifier) => {
    // save the specifier (and parent)
    edgesFound.push([parent, specifier]);
    return politeProxy();
  };

  const detonate = async (specifier) => {
    const edgesFound = [];
    // this should be happening in an iframe or a worker
    const realm = gimmeRealm();
    realm.global.exports = {};
    realm.global.module = { exports: realm.global.exports };
    realm.global.require = recordRequires(specifier, edgesFound);

    realm.importScript(resolve(specifier));

    return realm.done.then(() => edgesFound);
  };

  const createGraph = async (entrySpecifier) => {
    const knownSpecifiers = new Set();
    const haveDependencies = new Set();
    const moduleGraph = [];
    const edges = [[null, entrySpecifier]];
    while (edges.length > 0) {
      const edge = edges.shift();
      // I'm assuming this eliminates cycles and duplicates, but didn't think too hard about it
      if (!knownSpecifiers.has(edge[1])) {
        knownSpecifiers.add(edge[1]);
        const newEdges = await detonate(edge[1]);
        if (edges) edges.push(...newEdges);
        moduleGraph.push(...newEdges);
      }
    }
  };

  const modules = create(null);

  const whosthere = (stack) => {
    // figure out module name from stack
  };

  const MODULE = {};
  defineProperty(globalThis, "module", {
    value: MODULE,
    configurable: false,
    enumerable: false,
  });
  defineProperty(MODULE, "exports", {
    get() {},
    set(v) {},
  });

  defineProperty(globalThis, "exports", {
    get() {
      return MODULE.exports;
    },
    writable: false,
    configurable: false,
    enumerable: false,
  });

  const REQUIRE = (specifier) => {};

  defineProperty(globalThis, "require", {
    value: REQUIRE,
    writable: false,
    configurable: false,
    enumerable: false,
  });

  const importCJS = async (specifier) => {
    //initial setup - move here?

    REQUIRE(specifier);
  };
})();
