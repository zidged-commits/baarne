import hashlib
import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('restore', pathlib.Path(__file__).resolve().parents[1] / 'scripts/restore-certified-lifecycle-packet.py')
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class CertifiedPacketRestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.raw = b'{"public":"synthetic packet bytes; certificate not implied"}\n'
        self.pin = hashlib.sha256(self.raw).hexdigest()

    def archive(self, name, raw=None):
        directory = self.root / name
        directory.mkdir()
        (directory / restore.PACKET).write_bytes(self.raw if raw is None else raw)
        return directory

    def test_one_surviving_archive_recovers_exact_bytes_not_authority(self):
        good = self.archive('good')
        result = restore.restore([self.root / 'missing-a', self.root / 'missing-b', good], self.pin, self.root / 'new')
        self.assertEqual((self.root / 'new' / restore.PACKET).read_bytes(), self.raw)
        self.assertEqual(result['sourceArchiveIndex'], 2)
        self.assertFalse(result['cryptographicCertificateVerified'])
        self.assertFalse(result['semanticReplayVerified'])
        self.assertFalse(result['productionAuthorized'])

    def test_corrupt_source_is_skipped_with_explicit_pinned_survivor(self):
        bad = self.archive('bad', b'changed')
        good = self.archive('good')
        result = restore.restore([bad, good], self.pin, self.root / 'new')
        self.assertEqual(result['sourceArchiveIndex'], 1)
        self.assertEqual((bad / restore.PACKET).read_bytes(), b'changed')

    def test_wrong_pin_or_all_missing_create_no_destination(self):
        source = self.archive('source')
        for archives, pin in [([source], '0' * 64), ([self.root / 'missing'], self.pin)]:
            with self.assertRaisesRegex(ValueError, 'ARCHIVE_UNAVAILABLE_OR_INVALID'):
                restore.restore(archives, pin, self.root / 'never-created')
            self.assertFalse((self.root / 'never-created').exists())

    def test_existing_destination_and_invalid_pin_are_refused(self):
        source = self.archive('source')
        existing = self.root / 'existing'
        existing.mkdir()
        (existing / 'sentinel').write_bytes(b'unchanged')
        with self.assertRaisesRegex(FileExistsError, 'NEW_RESTORE_DIRECTORY_REQUIRED'):
            restore.restore([source], self.pin, existing)
        self.assertEqual((existing / 'sentinel').read_bytes(), b'unchanged')
        with self.assertRaisesRegex(ValueError, 'INVALID_EXTERNAL_PACKET_PIN'):
            restore.restore([source], '../not-a-pin', self.root / 'absent')
        self.assertFalse((self.root / 'absent').exists())


if __name__ == '__main__':
    unittest.main()
