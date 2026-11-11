import mongoose from 'mongoose';

const migrationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  appliedAt: { type: Date, default: Date.now },
}, { collection: 'warmer_migrations' });

const Migration = mongoose.models.WarmerMigration || mongoose.model('WarmerMigration', migrationSchema);

export async function runMigrations() {
  const migrations = [
    '20261111-content-library-and-media-jobs',
  ];
  for (const id of migrations) {
    await Migration.updateOne({ id }, { $setOnInsert: { id } }, { upsert: true });
  }
}
