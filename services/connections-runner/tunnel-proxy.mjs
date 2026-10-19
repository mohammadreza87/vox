import { connect } from 'node:net';
const path = process.argv[2];
if (!/^\/tmp\/vox-ssh-[A-Za-z0-9]+\/proxy\.sock$/.test(path ?? '')) process.exit(1);
const socket = connect(path);
socket.on('error', () => process.exit(1));
socket.pipe(process.stdout);
process.stdin.pipe(socket);
