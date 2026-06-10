import { exec } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { scheduleSequence } from '../src/sequences/scheduler';

const execAsync = promisify(exec);

async function setupDatabase() {
  try {
    const schemaPath = path.resolve(__dirname, "../src/db/schema.sql")
    const seedPath = path.resolve(__dirname, "../src/db/seed.sql")

    console.log('Running database migrations...');
    await execAsync(`docker exec -i sequencer-mysql mysql -u root -proot sequencer < ${schemaPath}`);
    console.log('Migrations completed.');

    console.log('Seeding database with test data...');
    await execAsync(`docker exec -i sequencer-mysql mysql -u root -proot sequencer < ${seedPath}`);
    console.log('Database seeding completed.');

    const result = await scheduleSequence({ sequenceId: 1 })
    console.log(`Scheduled : ${result.scheduled}, skipped ${result.skipped}`)

    process.exit(0);
  } catch (error) {
    console.error('Error setting up the database:', error);
    process.exit(1);
  }
}

setupDatabase();
