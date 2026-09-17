import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { MAX_IMPORT_FILE_BYTES } from "./import-plan.js";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const contained = (root, target) => {
  const value = relative(root, target);
  return value && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
};

// The export directory is an offline, operator-owned directory. Do not serve it
// over HTTP or let other local users mutate it while reviewing/importing.
export const createImportFileReader = async (directory) => {
  const root = await realpath(resolve(directory));
  return async (file, { maxBytes = MAX_IMPORT_FILE_BYTES } = {}) => {
    if (typeof file.local_path !== "string" || isAbsolute(file.local_path)) fail("file_path_unsafe");
    const candidate = resolve(root, file.local_path);
    if (!contained(root, candidate)) fail("file_path_unsafe");
    const target = await realpath(candidate);
    if (!contained(root, target) || (await lstat(candidate)).isSymbolicLink()) fail("file_path_unsafe");
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) fail("file_not_regular");
      if (info.size > maxBytes) fail("file_too_large");
      if (info.size !== Number(file.size_bytes)) fail("file_size_mismatch");
      const bytes = await handle.readFile();
      if (bytes.length > maxBytes || bytes.length !== info.size) fail("file_size_changed");
      return bytes;
    } finally {
      await handle.close();
    }
  };
};
