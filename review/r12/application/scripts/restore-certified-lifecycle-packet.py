"""Restore pinned public proof bytes; does not grant finality or live authority.

Run the existing Go certificate verifier and fresh Node semantic replay after
restoration, with a separately authentic Genesis pin. No network or secret input.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re

MAX_PACKET_BYTES = 16 * 1024 * 1024
PACKET = 'public-proof.json'


def restore(archives, expected, destination):
    destination = pathlib.Path(destination)
    if destination.exists() or destination.is_symlink():
        raise FileExistsError('NEW_RESTORE_DIRECTORY_REQUIRED')
    if not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise ValueError('INVALID_EXTERNAL_PACKET_PIN')
    if not 1 <= len(archives) <= 16:
        raise ValueError('INVALID_ARCHIVE_COUNT')
    payload, source_index = None, None
    unavailable = []
    for index, directory in enumerate(archives):
        directory = pathlib.Path(directory)
        file = directory / PACKET
        try:
            if directory.is_symlink() or getattr(directory, 'is_junction', lambda: False)() or file.is_symlink():
                raise ValueError('INVALID_ARCHIVE_FILE')
            if not directory.is_dir() or not file.is_file() or file.stat().st_size > MAX_PACKET_BYTES:
                raise ValueError('INVALID_ARCHIVE_FILE')
            with file.open('rb') as handle:
                content = handle.read(MAX_PACKET_BYTES + 1)
            if len(content) > MAX_PACKET_BYTES or hashlib.sha256(content).hexdigest() != expected:
                raise ValueError('ARCHIVE_CHECKSUM_MISMATCH')
            payload, source_index = content, index
            break
        except (OSError, ValueError) as error:
            unavailable.append({'archiveIndex': index, 'reason': type(error).__name__})
    if payload is None:
        raise ValueError('ARCHIVE_UNAVAILABLE_OR_INVALID')
    # No destination is created for wrong pins/unavailable inputs. Never merge
    # into a previous restore or write a source/archive directory.
    destination.mkdir(mode=0o700)
    with (destination / PACKET).open('xb') as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    if os.name != 'nt':
        descriptor = os.open(destination, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    return {'version': 'BAARNE_CERTIFIED_PACKET_RESTORE_V1', 'status': 'BYTES_RESTORED_VERIFICATION_REQUIRED',
            'packetSha256': expected, 'bytes': len(payload), 'sourceArchiveIndex': source_index,
            'unavailableArchives': unavailable, 'cryptographicCertificateVerified': False,
            'semanticReplayVerified': False, 'genesisAuthorityEstablished': False,
            'productionAuthorized': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', action='append', required=True)
    parser.add_argument('--packet-sha256', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(restore(args.archive, args.packet_sha256, args.output)))
