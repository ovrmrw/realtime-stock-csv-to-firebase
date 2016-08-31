import fs from 'fs';


export function createCsvStoreDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }
}