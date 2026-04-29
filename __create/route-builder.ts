import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import type { Handler } from 'hono/types';
import updatedFetch from '../src/__create/fetch';

const API_BASENAME = '/api';
const api = new Hono();

// Get current directory
const __dirname = join(fileURLToPath(new URL('.', import.meta.url)), '../src/app/api');
if (globalThis.fetch) {
  globalThis.fetch = updatedFetch;
}

function routeImportUrl(routeFile: string) {
  return `${pathToFileURL(routeFile).href}?update=${Date.now()}`;
}

// Recursively find all route.js files
async function findRouteFiles(dir: string): Promise<string[]> {
  const files = await readdir(dir);
  let routes: string[] = [];

  for (const file of files) {
    try {
      const filePath = join(dir, file);
      const statResult = await stat(filePath);

      if (statResult.isDirectory()) {
        routes = routes.concat(await findRouteFiles(filePath));
      } else if (file === 'route.js') {
        // Handle root route.js specially
        if (filePath === join(__dirname, 'route.js')) {
          routes.unshift(filePath); // Add to beginning of array
        } else {
          routes.push(filePath);
        }
      }
    } catch (error) {
      console.error(`Error reading file ${file}:`, error);
    }
  }

  return routes;
}

// Helper function to transform file path to Hono route path
function getHonoPath(routeFile: string): { name: string; pattern: string }[] {
  const relativePath = relative(__dirname, routeFile);
  const parts = relativePath.split(sep).filter(Boolean);
  const routeParts = parts.slice(0, -1); // Remove 'route.js'
  if (routeParts.length === 0) {
    return [{ name: 'root', pattern: '' }];
  }
  const transformedParts = routeParts.map((segment) => {
    const match = segment.match(/^\[(\.{3})?([^\]]+)\]$/);
    if (match) {
      const [_, dots, param] = match;
      return dots === '...'
        ? { name: param, pattern: `:${param}{.+}` }
        : { name: param, pattern: `:${param}` };
    }
    return { name: segment, pattern: segment };
  });
  return transformedParts;
}

// Import and register all routes
async function registerRoutes() {
  const routeFiles = (
    await findRouteFiles(__dirname).catch((error) => {
      console.error('Error finding route files:', error);
      return [];
    })
  )
    .slice()
    .sort((a, b) => {
      return b.length - a.length;
    });

  console.log('Found route files:', routeFiles);

  // Clear existing routes
  api.routes = [];

  for (const routeFile of routeFiles) {
    try {
      const route = await import(/* @vite-ignore */ routeImportUrl(routeFile));

      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      for (const method of methods) {
        try {
          if (route[method]) {
            const parts = getHonoPath(routeFile);
            const honoPath = `/${parts.map(({ pattern }) => pattern).join('/')}`;
            const handler: Handler = async (c) => {
              try {
                console.log(`[${method}] ${honoPath} - Request received`);
                
                let response: Response;
                try {
                  if (import.meta.env.DEV) {
                    console.log(`[${method}] ${honoPath} - Loading dev version`);
                    const updatedRoute = await import(
                      /* @vite-ignore */ routeImportUrl(routeFile)
                    );
                    if (!updatedRoute[method]) {
                      throw new Error(`Handler ${method} not found in route`);
                    }
                    console.log(`[${method}] ${honoPath} - Calling handler`);
                    response = await updatedRoute[method](c.req.raw);
                  } else {
                    if (!route[method]) {
                      throw new Error(`Handler ${method} not found in route`);
                    }
                    response = await route[method](c.req.raw);
                  }
                } catch (handlerError) {
                  console.error(`[${method}] ${honoPath} - Handler error:`, handlerError);
                  // Return error response instead of throwing
                  response = new Response(
                    JSON.stringify({
                      error: "Internal server error",
                      details: handlerError instanceof Error ? handlerError.message : String(handlerError)
                    }),
                    { status: 500, headers: { 'Content-Type': 'application/json' } }
                  );
                }

                console.log(`[${method}] ${honoPath} - Returning response with status ${response.status}`);
                return response;
              } catch (error) {
                console.error(`[${method}] ${honoPath} - Unexpected error:`, error);
                // Return error response for any unexpected errors
                return new Response(
                  JSON.stringify({
                    error: "Unexpected server error",
                    details: error instanceof Error ? error.message : String(error)
                  }),
                  { status: 500, headers: { 'Content-Type': 'application/json' } }
                );
              }
            };
            const methodLowercase = method.toLowerCase();
            switch (methodLowercase) {
              case 'get':
                api.get(honoPath, handler);
                break;
              case 'post':
                api.post(honoPath, handler);
                break;
              case 'put':
                api.put(honoPath, handler);
                break;
              case 'delete':
                api.delete(honoPath, handler);
                break;
              case 'patch':
                api.patch(honoPath, handler);
                break;
              default:
                console.warn(`Unsupported method: ${method}`);
                break;
            }
          }
        } catch (error) {
          console.error(`Error registering route ${routeFile} for method ${method}:`, error);
        }
      }
    } catch (error) {
      console.error(`Error importing route file ${routeFile}:`, error);
    }
  }
}

// Initial route registration
await registerRoutes();

// Hot reload routes in development
if (import.meta.env.DEV) {
  import.meta.glob('../src/app/api/**/route.js', {
    eager: true,
  });
  if (import.meta.hot) {
    import.meta.hot.accept((newSelf) => {
      registerRoutes().catch((err) => {
        console.error('Error reloading routes:', err);
      });
    });
  }
}

export { api, API_BASENAME };
