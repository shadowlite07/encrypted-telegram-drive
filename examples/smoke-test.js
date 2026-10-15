const fs = require('node:fs');
const path = require('node:path');
let createDrive;
try {
  ({ createDrive } = require('encrypted-telegram-drive'));
} catch (error) {
  console.warn('Package is not linked; falling back to local source. Run "npm link" first to test package resolution.');
  ({ createDrive } = require('../src/index.js'));
}

async function main() {
  const configFile = process.env.CONFIG_PATH || './config.json';
  const driveKey = process.env.DRIVE_KEY;
  if (!driveKey) throw new Error('DRIVE_KEY is required');

  const originalFile = path.resolve('./smoke-test.txt');
  const downloadedFile = path.resolve('./smoke-test-downloaded.txt');
  fs.writeFileSync(originalFile, 'TeleStore smoke test ' + new Date().toISOString());

  const drive = createDrive(configFile, driveKey, { quiet: false });

  try {
    console.log('Creating smoke-test folder...');
    const folder = await drive.folders.create('Smoke Test Folder');

    console.log('Uploading file into folder...');
    const uploaded = await drive.files.upload(originalFile, {
      folderId: folder.id,
      fresh: true,
      cleanupOnFail: true
    });
    console.log('Uploaded:', uploaded.fileId);

    console.log('Downloading file...');
    const downloaded = await drive.files.download(uploaded.fileId, downloadedFile);
    console.log('Downloaded:', downloaded.outPath);

    console.log('Verifying file...');
    const verified = await drive.files.verify(uploaded.fileId);
    console.log('Verified:', verified.verified);

    const originalHash = fs.readFileSync(originalFile);
    const downloadedHash = fs.readFileSync(downloadedFile);
    if (originalHash.equals(downloadedHash) === false) {
      throw new Error('Downloaded file differs from original');
    }

    console.log('Moving file to root...');
    await drive.files.move(uploaded.fileId, 'root');

    console.log('Deleting test file...');
    await drive.files.delete(uploaded.fileId);

    console.log('Deleting smoke folder...');
    try {
      await drive.folders.delete(folder.id);
    } catch (e) {
      console.log('Folder cleanup skipped:', e.message);
    }

    console.log('\nSmoke test passed.');
  } finally {
    drive.close();
    try { fs.unlinkSync(originalFile); } catch (e) {}
    try { fs.unlinkSync(downloadedFile); } catch (e) {}
  }
}

main().catch((error) => {
  console.error('Smoke test failed:', error && error.stack ? error.stack : error);
  process.exit(1);
});
