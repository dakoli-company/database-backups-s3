require('dotenv').config();
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const s3 = require("@aws-sdk/client-s3");
const fs = require('fs');

function loadConfig() {
  const requiredEnvars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_S3_REGION',
    'AWS_S3_BUCKET'
  ];
  
  for (const key of requiredEnvars) {
    if (!process.env[key]) {
      throw new Error(`Environment variable ${key} is required`);
    }
  }

  return {
    aws: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_S3_REGION,
      s3_bucket: process.env.AWS_S3_BUCKET
    },
    databases: process.env.DATABASES ? process.env.DATABASES.split(",") : [],
  };
}

const config = loadConfig();

const s3Client = new s3.S3Client(config.aws);

async function processBackup() {
  console.log("--------------------------------------------------");
  if (config.databases.length === 0) {
    console.log("No databases defined.");
    return;
  }

  for (const [index, databaseURI] of config.databases.entries()) {
    const databaseIteration = index + 1;
    const totalDatabases = config.databases.length;

    const url = new URL(databaseURI);
    const dbType = url.protocol.slice(0, -1); // remove trailing colon
    const dbName = url.pathname.substring(1); // extract db name from URL
    const dbHostname = url.hostname;
    const dbUser = url.username;
    const dbPassword = url.password;
    const dbPort = url.port;
  
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const timestamp = `${yyyy}-${mm}-${dd}_${hh}:${min}:${ss}`;
    const filename = `backup-${dbType}-${timestamp}-${dbName}-${dbHostname}.tar.gz`;
    const filepath = `/${filename}`;

    
    console.log(`\n[${databaseIteration}/${totalDatabases}] ${dbType}/${dbName} Backup in progress...`);
    let dumpCommand = `pg_dump "${databaseURI}" -F c > "${filepath}.dump"`;
    let versionCommand = 'psql --version';

    try {
      // Log database client version
      try {
        const { stdout: versionOutput } = await exec(versionCommand);
        console.log(`Using ${dbType} client version:`, versionOutput.trim());
      } catch (versionError) {
        console.warn(`Failed to get ${dbType} client version:`, versionError.message);
      }

      // 1. Execute the dump command
      await exec(dumpCommand);
      console.log("✅ 1. Dumped data");

      // 2. Compress the dump file
      await exec(`tar -czvf ${filepath} ${filepath}.dump`);
      console.log("✅ 2. Compressed the dump file");

      // 3. Read the compressed file
      const data = fs.readFileSync(filepath);
      console.log("✅ 3. Read compressed file");

      // 4. Upload to S3
      const params = {
        Bucket: config.aws.s3_bucket,
        Key: filename,
        Body: data
      };

      const putCommand = new s3.PutObjectCommand(params);
      await s3Client.send(putCommand);
      
      console.log(`✅ 4. Successfully uploaded db backup for database ${dbType} ${dbName} ${dbHostname}.`);

      // 5. Clean up temporary files
      await exec(`rm -f ${filepath} ${filepath}.dump`);
      console.log("✅ 5. Cleaned temporary files");

      // 6. Clean memory
      if (global.gc) {
        global.gc();
        console.log("✅ 6. Cleaned memory");
      }  
    } catch (error) {
      console.error(`An error occurred while processing the database ${dbType} ${dbName}, host: ${dbHostname}): ${error}`);
      console.error(error);
    } finally {
       process.exit(); 
    }
  }
}

processBackup();
