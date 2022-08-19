describe("oom", () => {
  it("ram intensive", () => {
    // eat 2G of memory
    const size = 2147483647
    const arr = []
    for (let i = 0; i < size; i++) {
      arr.push(i)
    }

    for (let i = 0; i < size; i++) {
      console.log(arr[i])
    }
  })
})
