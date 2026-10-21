import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import '../../../pet/pet.css';
import './lab.css';
import { PetLab } from './PetLab';

export const metadata: Metadata = { title: 'Vox pet lab', robots: { index: false } };

/** The pet engine on a real device: any reaction on any preset look. Only with NEXT_PUBLIC_STUDIO_LAB=1. */
export default function PetLabPage() {
  if (process.env.NEXT_PUBLIC_STUDIO_LAB !== '1') notFound();
  return <PetLab />;
}
