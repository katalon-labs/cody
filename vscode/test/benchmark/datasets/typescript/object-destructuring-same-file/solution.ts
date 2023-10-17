interface Person {
    name: string
    age: number
    createdAt: number
}

export function getSummary(person: Person): string {
    const { name, age, createdAt } = person
    return `User ${name}, ${age} years old, was created on ${new Date(createdAt).toLocaleDateString()}.`
}