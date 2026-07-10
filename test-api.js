async function test() {
  try {
    const res = await fetch("https://api.semanticscholar.org/graph/v1/paper/search?query=test&limit=1", {
      headers: { 'User-Agent': 'ScholarCloud/1.0.0' }
    });
    console.log('Status:', res.status);
    console.log('Headers:', JSON.stringify(Object.fromEntries(res.headers.entries())));
    const text = await res.text();
    console.log('Body:', text);
  } catch (e) {
    console.error('Error:', e);
  }
}
test();
