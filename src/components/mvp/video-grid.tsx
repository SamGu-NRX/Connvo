import Image from "next/image";

const participants = [
  { id: 1, name: "You" },
  { id: 2, name: "John Doe" },
  { id: 3, name: "Jane Smith" },
  { id: 4, name: "Alice Johnson" },
];

export default function VideoGrid() {
  return (
    <div className="grid flex-1 grid-cols-2 gap-2 overflow-auto p-2">
      {participants.map((participant) => (
        <div
          key={participant.id}
          className="relative aspect-video overflow-hidden rounded-lg bg-gray-700"
        >
          <Image
            src={`/placeholder.svg?height=360&width=640&text=${participant.name}`}
            alt={participant.name}
            layout="fill"
            objectFit="cover"
          />
          <div className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-sm">
            {participant.name}
          </div>
        </div>
      ))}
    </div>
  );
}
