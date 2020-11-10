const i_fs = require('fs');
const i_path = require('path');
const i_url = require('url');

const i_env = {
   debug: !!process.env.NODEPAD_DEBUG,
   server: {
      host: process.env.NODEPAD_HOST || '127.0.0.1',
      port: parseInt(process.env.NODEPAD_PORT || '9090'),
      staticDir: i_path.resolve(__dirname, 'static'),
      httpsCADir: process.env.NODEPAD_HTTPS_CA_DIR?i_path.resolve(process.env.NODEPAD_HTTPS_CA_DIR):null,
   },
};

const Mime = {
   '.html': 'text/html',
   '.css': 'text/css',
   '.js': 'text/javascript',
   '.svg': 'image/svg+xml',
   '.json': 'application/json',
   _default: 'text/plain',
   lookup: (filename) => {
      let ext = i_path.extname(filename);
      if (!ext) return Mime._default;
      let content_type = Mime[ext];
      if (!content_type) content_type = Mime._default;
      return content_type;
   }
};

const Cache = {
   maxSize: 128 * 1024 * 1024, /* 128 MB */
   size: 0,
   pool: null
};

function basicRoute (req, res, router) {
   const r = i_url.parse(req.url);
   const originPath = r.pathname.split('/');
   const path = originPath.slice();
   const query = {};
   let f = router;
   if (r.query) r.query.split('&').forEach((one) => {
      let key, val;
      let i = one.indexOf('=');
      if (i < 0) {
         key = one;
         val = '';
      } else {
         key = one.substring(0, i);
         val = one.substring(i+1);
      }
      if (key in query) {
         if(Array.isArray(query[key])) {
            query[key].push(val);
         } else {
            query[key] = [query[key], val];
         }
      } else {
         query[key] = val;
      }
   });
   path.shift();
   while (path.length > 0) {
      let key = path.shift();
      f = f[key];
      if (!f) break;
      if (typeof(f) === 'function') {
         return f(req, res, {
            path: path,
            query: query
         });
      }
   }
   if (i_env.server.staticDir) {
      let r = serveStatic(res, i_env.server.staticDir, originPath);
      if (r) return r;
   }
   return serveCode(req, res, 404, 'Not Found');
}

function serveCode(req, res, code, text) {
   res.writeHead(code || 500, text || '');
   res.end();
}

function serveStatic (res, base, path) {
   if (path.indexOf('..') >= 0) return false;
   path = path.slice(1);
   if (!path.join('')) path = ['index.html'];
   if (!Cache.pool) Cache.pool = {};
   let filename = i_path.join(base, ...path);
   let mimetype = Mime.lookup(filename);
   if (mimetype !== Mime._default) {
      res.setHeader('Content-Type', mimetype);
   }
   let buf = Cache.pool[filename], state;
   if (buf) {
      if (!i_fs.existsSync(filename)) {
         delete buf[filename];
         return false;
      }
      state = i_fs.statSync(filename);
      if (buf.mtime === state.mtimeMs) {
         buf = buf.raw;
      } else {
         buf.mtime = state.mtimeMs;
         buf.raw = i_fs.readFileSync(filename);
         buf = buf.raw;
      }
   } else {
      if (!i_fs.existsSync(filename)) {
         return false;
      }
      buf = i_fs.readFileSync(filename);
      state = i_fs.statSync(filename);
      Cache.pool[filename] = {
         mtime: state.mtimeMs,
         raw: buf
      };
      Cache.size += buf.length + filename.length;
      while (Cache.size > Cache.maxSize) {
         let keys = Object.keys(Cache.pool);
         let key = keys[~~(Math.random() * keys.length)];
         let val = Cache.pool[key];
         if (!key || !val) return false; // should not be
         delete Cache.pool[key];
         Cache.size -= val.raw.length + key.length;
      }
   }
   res.write(buf);
   res.end();
   return true;
}

function createServer(router) {
   let server = null;
   router = Object.assign({}, router);
   if (i_env.server.httpsCADir) {
      const i_https = require('https');
      const https_config = {
         // openssl req -newkey rsa:2048 -new -nodes -x509 -days 365 -keyout ca.key -out ca.crt
         key: i_fs.readFileSync(i_path.join(i_env.server.httpsCADir, 'ca.key')),
         cert: i_fs.readFileSync(i_path.join(i_env.server.httpsCADir, 'ca.crt')),
      };
      server = i_https.createServer(https_config, (req, res) => {
         basicRoute(req, res, router);
      });
   } else {
      const i_http = require('http');
      server = i_http.createServer((req, res) => {
         basicRoute(req, res, router);
      });
   }
   return server;
}

async function readBinaryRequest(req) {
   return new Promise((resolve, reject) => {
      let body = [];
      req.on('data', (chunk) => { body.push(chunk); });
      req.on('end', () => {
         body = Buffer.concat(body);
         resolve(body);
      });
      req.on('error', reject);
   });
}
async function readJsonRequest(req) {
   return new Promise((resolve, reject) => {
      readBinaryRequest(req).then((buf) => {
         try {
            body = JSON.parse(buf.toString());
            resolve(body);
         } catch(e) {
            reject(e);
         }
      }, reject);
   });
}

const v1 = {
   list: async (req, res) => {
      try {
         req.body = await readJsonRequest(req);
      } catch (e) { }
      if (!req.body) return serveCode(req, res, 400);
      if (!req.body.path) return serveCode(req, res, 400);
      let parent = req.body.path,
          symbols = i_fs.readdirSync(parent),
          files = [],
          dirs = [];
      symbols.forEach((x) => {
         try {
            if (i_fs.lstatSync(i_path.join(parent, x)).isDirectory()) {
               dirs.push(x);
            } else {
               files.push(x);
            }
         } catch (e) {
            // no permission
         }
      });
      res.end(JSON.stringify({ dirs, files }));
   },
   open: async (req, res) => {
      try {
         req.body = await readJsonRequest(req);
      } catch (e) { }
      let file = req.body.path;
      res.end(JSON.stringify({
         path: file,
         text: i_fs.readFileSync(file).toString()
      }));
   },
   save: async (req, res) => {
      try {
         req.body = await readJsonRequest(req);
      } catch (e) { }
      let file = req.body.path,
          text = req.body.text;
      i_fs.writeFileSync(file, text);
      res.end(JSON.stringify({ path: file }));
   },
   plugins: (req, res) => {
      let parent = i_path.join(i_env.server.staticDir, '..', 'plugin'),
          symbols = i_fs.readdirSync(parent),
          plugins = [];
      symbols.forEach((x) => {
         try {
            if (i_fs.lstatSync(i_path.join(parent, x)).isDirectory()) {
               plugins.push(x);
            }
         } catch (e) {
            // no permission
         }
      });
      res.end(JSON.stringify({ plugins, path: parent }));
   }
};
const server = createServer({
   api: {
      nodebase: {
         nodepad: { v1: v1 }
      },
   },
   test: (_req, res, options) => {
      res.end(JSON.stringify({
         text: 'hello world',
         path: `/${options.path.join('/')}`
      }));
   }
});
server.listen(i_env.server.port, i_env.server.host, () => {
   console.log(`Nodepad SERVER is listening at ${i_env.server.host}:${i_env.server.port}`);
});
