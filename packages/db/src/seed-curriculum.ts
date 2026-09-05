/**
 * The master curriculum: CBSE Artificial Intelligence (417), Class 9.
 *
 * This is PLATFORM data. It exists exactly once and every school reads the same
 * rows. Nothing here carries a tenant_id, and nothing here is editable from
 * inside a school portal — see 003_rls.sql.
 */

export type TestCase = {
  name: string
  stdin?: string
  /** substring that must appear in stdout */
  expect?: string
  /** regex the source must match — e.g. the task says "use a loop" */
  requireSource?: string
  /** regex the source must NOT match — e.g. "do not use sum()" */
  forbidSource?: string
  hint?: string
}

export const UNITS = [
  { code: 'U1', title: 'AI Reflection, Project Cycle & Ethics', hours: '55 hrs · 10 marks', marks: 10, status: 'published' },
  { code: 'U2', title: 'Data Literacy', hours: '50 hrs · 10 marks', marks: 10, status: 'published' },
  { code: 'U3', title: 'Maths for AI — Statistics & Probability', hours: '25 hrs · 7 marks', marks: 7, status: 'published' },
  { code: 'U4', title: 'Introduction to Generative AI', hours: '20 hrs · 5 marks', marks: 5, status: 'drafting' },
  { code: 'U5', title: 'Introduction to Python', hours: '10 hrs · 8 marks', marks: 8, status: 'published' },
]

export const VIDEOS: Array<{ unit: string; title: string; seconds: number; summary: string[] }> = [
  { unit: 'U1', title: 'What we mean by artificial intelligence', seconds: 292, summary: [
    'A machine that improves at a task from data, not from new instructions',
    'Where you already meet AI in a day without noticing',
    'Why "the computer decided" is never a complete answer' ] },
  { unit: 'U1', title: 'The AI project cycle, start to finish', seconds: 376, summary: [
    'Problem scoping comes before any data is collected',
    'Data acquisition, exploration, modelling, evaluation',
    'Most projects fail in scoping, not in modelling' ] },
  { unit: 'U1', title: 'Bias, fairness and who gets left out', seconds: 341, summary: [
    'A model learns the world it was shown, including its gaps',
    'Two real examples of biased training data',
    'Questions to ask before trusting a prediction' ] },
  { unit: 'U2', title: 'Where data comes from', seconds: 318, summary: [
    'Surveys, sensors, records and the web',
    'Primary versus secondary sources',
    'Consent, and why it matters more when the subject is a child' ] },
  { unit: 'U2', title: 'Cleaning messy data', seconds: 402, summary: [
    'Missing values, duplicates and impossible values',
    'Why cleaning is most of the work in a real project',
    'What you must never quietly delete' ] },
  { unit: 'U3', title: 'Mean, median and mode explained', seconds: 330, summary: [
    'Three different answers to "what is typical here"',
    'How one very large value drags the mean but not the median',
    'Choosing the right one for the question you were asked' ] },
  { unit: 'U3', title: 'Reading a graph without being fooled', seconds: 287, summary: [
    'Axes that do not start at zero',
    'Bar, line and pie — and when each is wrong',
    'Reading the scale before reading the shape' ] },
  { unit: 'U3', title: 'Probability of an everyday event', seconds: 305, summary: [
    'Counting outcomes that could happen',
    'Probability as a number between 0 and 1',
    'Why past results do not change the next coin toss' ] },
  { unit: 'U5', title: 'What a variable holds', seconds: 252, summary: [
    'A variable is a name that refers to a value',
    'Naming rules, and names that make code readable',
    'Reassigning a name does not change the old value' ] },
  { unit: 'U5', title: 'Data types and type conversion', seconds: 306, summary: [
    'int, float, str and bool',
    'type() tells you what Python is actually holding',
    'int("25") and str(25) go in opposite directions' ] },
  { unit: 'U5', title: 'Taking input from the user', seconds: 228, summary: [
    'input() waits for the person to type and press enter',
    'Whatever they type comes back as text, even if it looks like a number',
    'int() turns that text into a number you can do maths with' ] },
  { unit: 'U5', title: 'Conditions: if, elif, else', seconds: 380, summary: [
    'Comparing with ==, !=, < and >',
    'elif runs only when the ones above it did not',
    'Indentation is what tells Python which lines belong inside' ] },
  { unit: 'U5', title: 'Loops: for and while', seconds: 422, summary: [
    'for repeats a fixed number of times; while repeats until something changes',
    'range(1, 11) gives you 1 to 10',
    'The commonest bug: a while loop whose condition never becomes false' ] },
]

export const MATERIALS: Array<{ unit: string; title: string; kind: string; pages: number; body: any[] }> = [
  { unit: 'U5', title: 'Variables and data types — notes', kind: 'Notes', pages: 6, body: [
    { type: 'heading', level: 3, text: 'A variable is a name for a value' },
    { type: 'paragraph', text: 'When you write age = 14, Python stores the number 14 and lets you reach it again by the name age. The name is not the value; it points at the value.' },
    { type: 'code', language: 'python', source: 'age = 14\nname = "Aarav"\nprint(name, "is", age)' },
    { type: 'heading', level: 3, text: 'Four types you will use constantly' },
    { type: 'list', items: ['int — a whole number, like 14', 'float — a number with a decimal point, like 14.5', 'str — text, always in quotes', 'bool — True or False, with capital letters'] },
    { type: 'callout', variant: 'tip', text: 'type(x) tells you what Python is actually holding. When something behaves strangely, print the type first.' },
  ] },
  { unit: 'U5', title: 'input() and type conversion — worksheet', kind: 'Worksheet', pages: 3, body: [
    { type: 'heading', level: 3, text: 'Taking input from the user' },
    { type: 'paragraph', text: 'A program becomes useful when it can ask a question and use the answer. In Python that is done with input().' },
    { type: 'heading', level: 3, text: 'The rule to remember' },
    { type: 'paragraph', text: 'input() always gives you text. Even when the person types 25, Python holds it as the characters "2" and "5", not the number twenty-five.' },
    { type: 'code', language: 'python', source: 'age = input("Your age? ")\nprint(age + 1)      # this breaks\nprint(int(age) + 1) # this works' },
    { type: 'heading', level: 3, text: 'Three things that go wrong' },
    { type: 'list', items: [
      'Adding to text instead of a number, so 25 + 1 becomes an error',
      'Forgetting the space at the end of the question, so the answer sticks to the question',
      'Using int() on something that is not a number at all' ] },
    { type: 'heading', level: 3, text: 'Try this yourself' },
    { type: 'paragraph', text: 'Write a program that asks for two numbers and prints their total. If it prints the two numbers side by side instead of adding them, you have found the rule above.' },
  ] },
  { unit: 'U5', title: 'Python quick reference card', kind: 'PDF', pages: 2, body: [
    { type: 'heading', level: 3, text: 'Everything from Unit 5 on one page' },
    { type: 'code', language: 'python', source: 'x = 5             # int\ny = 5.0           # float\ns = "five"        # str\nok = True         # bool\n\nint("5")          # text  -> number\nstr(5)            # number -> text\n\nif x > 3:\n    print("big")\nelif x == 3:\n    print("three")\nelse:\n    print("small")\n\nfor i in range(1, 11):\n    print(i)' },
    { type: 'callout', variant: 'tip', text: 'Print this and keep it in your practical file. It is allowed in the lab.' },
  ] },
  { unit: 'U3', title: 'Mean, median and mode — notes', kind: 'Notes', pages: 5, body: [
    { type: 'heading', level: 3, text: 'Three answers to one question' },
    { type: 'paragraph', text: 'All three try to say what is typical in a set of numbers, and they disagree in exactly the situations that matter.' },
    { type: 'list', items: [
      'Mean — add everything, divide by how many. Moves when one value is extreme.',
      'Median — put them in order, take the middle one. Barely moves.',
      'Mode — the value that appears most often. Useful for categories, not marks.' ] },
    { type: 'heading', level: 3, text: 'When median is the better choice' },
    { type: 'paragraph', text: 'Marks: 12, 14, 15, 16, 98. The mean is 31, which describes nobody in the class. The median is 15, which describes almost everyone. One unusual value dragged the mean away from the truth.' },
  ] },
  { unit: 'U3', title: 'Reading charts — practice sheet', kind: 'Worksheet', pages: 4, body: [
    { type: 'heading', level: 3, text: 'Read the scale before the shape' },
    { type: 'paragraph', text: 'A bar chart whose axis starts at 90 instead of 0 makes a two-point difference look enormous. Check the axis first, every time.' },
    { type: 'list', items: ['Bar chart — comparing separate groups', 'Line chart — something changing over time', 'Pie chart — parts of one whole, and only when there are few parts'] },
  ] },
  { unit: 'U1', title: 'The AI project cycle — notes', kind: 'Notes', pages: 4, body: [
    { type: 'heading', level: 3, text: 'Five stages, in order' },
    { type: 'list', items: [
      'Problem scoping — who has the problem, and what would count as solving it',
      'Data acquisition — where the data comes from, and with whose permission',
      'Data exploration — looking before modelling',
      'Modelling — the part everyone thinks is the whole job',
      'Evaluation — does it work for the people it was built for' ] },
    { type: 'callout', variant: 'tip', text: 'If you cannot write the problem statement in one sentence, you are not ready to collect data.' },
  ] },
  { unit: 'U2', title: 'Data collection — worksheet', kind: 'Worksheet', pages: 3, body: [
    { type: 'heading', level: 3, text: 'Plan the collection before you collect' },
    { type: 'paragraph', text: 'Write down the question first. Then decide what single piece of data would answer it, and only then design the form.' },
    { type: 'list', items: ['What exactly are you measuring?', 'Who is being asked, and did they agree?', 'What will you do with a blank answer?'] },
  ] },
]

export const PRACTICE: Array<{
  unit: string; title: string; level: string; brief: string; starter: string;
  hints: string[]; solution: string; tests: TestCase[]
}> = [
  { unit: 'U5', title: 'Print your own name', level: 'Easy',
    brief: 'Print your own name on the screen. One line is enough.',
    starter: '# Print your name\n',
    hints: ['print() puts something on the screen', 'Text goes inside quotes: print("Aarav")'],
    solution: 'print("Aarav")',
    tests: [{ name: 'prints something', expect: '', requireSource: 'print\\s*\\(', hint: 'Use print() so we can see your answer.' }] },

  { unit: 'U5', title: 'Add two numbers the user types', level: 'Easy',
    brief: 'Ask for two numbers and print their total. Remember what input() gives you back.',
    starter: 'a = input("First number: ")\nb = input("Second number: ")\n\n# print the total\n',
    hints: ['input() gives text, not a number', 'int(a) + int(b) is the total'],
    solution: 'a = input("First number: ")\nb = input("Second number: ")\nprint(int(a) + int(b))',
    tests: [
      { name: '3 and 4 make 7', stdin: '3\n4\n', expect: '7' },
      { name: '25 and 17 make 42', stdin: '25\n17\n', expect: '42', hint: 'If you saw 2517, you added the text instead of the numbers.' },
    ] },

  { unit: 'U5', title: 'Convert kilometres to metres', level: 'Easy',
    brief: 'Ask for a distance in kilometres and print it in metres.',
    starter: 'km = input("Kilometres: ")\n',
    hints: ['One kilometre is 1000 metres', 'int(km) * 1000'],
    solution: 'km = input("Kilometres: ")\nprint(int(km) * 1000)',
    tests: [
      { name: '3 km is 3000 m', stdin: '3\n', expect: '3000' },
      { name: '12 km is 12000 m', stdin: '12\n', expect: '12000' },
    ] },

  { unit: 'U5', title: 'Biggest of three numbers', level: 'Medium',
    brief: 'Ask for three numbers and print the biggest one. Use if and elif — not max().',
    starter: 'a = int(input())\nb = int(input())\nc = int(input())\n\n# which is biggest?\n',
    hints: ['Compare a with b first, then compare the winner with c', 'if a > b and a > c:'],
    solution: 'a = int(input())\nb = int(input())\nc = int(input())\nif a > b and a > c:\n    print(a)\nelif b > c:\n    print(b)\nelse:\n    print(c)',
    tests: [
      { name: '4, 9, 2 gives 9', stdin: '4\n9\n2\n', expect: '9', forbidSource: 'max\\s*\\(', hint: 'The task asks you to compare them yourself, without max().' },
      { name: '11, 3, 7 gives 11', stdin: '11\n3\n7\n', expect: '11' },
    ] },

  { unit: 'U5', title: 'Times table using a loop', level: 'Medium',
    brief: 'Print the 5 times table, from 5 x 1 up to 5 x 10, one line each. Use a loop — do not write ten print lines.',
    starter: '# Print the 5 times table using a loop\n',
    hints: ['range(1, 11) gives you the numbers 1 to 10', 'Inside the loop, print(5, "x", i, "=", 5*i)'],
    solution: 'for i in range(1, 11):\n    print(5, "x", i, "=", 5 * i)',
    tests: [
      { name: 'uses a loop', requireSource: '(for\\s+\\w+\\s+in|while\\s)', hint: 'The task asks for a loop. Ten print lines will not pass.' },
      { name: 'starts at 5', expect: '5' },
      { name: 'reaches 50', expect: '50', hint: 'The last line should be 5 x 10 = 50.' },
    ] },

  { unit: 'U5', title: 'Count the even numbers in a list', level: 'Hard',
    brief: 'Given the list below, print how many of the numbers are even.',
    starter: 'numbers = [4, 7, 10, 3, 8, 15, 2]\n\n# count the even ones\n',
    hints: ['A number is even when n % 2 == 0', 'Keep a counter starting at 0 and add 1 each time'],
    solution: 'numbers = [4, 7, 10, 3, 8, 15, 2]\ncount = 0\nfor n in numbers:\n    if n % 2 == 0:\n        count = count + 1\nprint(count)',
    tests: [
      { name: 'uses a loop', requireSource: '(for\\s+\\w+\\s+in|while\\s)' },
      { name: 'answer is 4', expect: '4', hint: '4, 10, 8 and 2 are even.' },
    ] },
]

const RUBRIC = [
  { key: 'output', label: 'Correct output', max: 4 },
  { key: 'construct', label: 'Uses the required construct', max: 3 },
  { key: 'readable', label: 'Readable, commented', max: 2 },
  { key: 'ontime', label: 'Submitted on time', max: 1 },
]

export const GRADED_LABS: Array<{
  no: number; unit: string; title: string; brief: string; mode: string; starter: string; tests: TestCase[]
}> = [
  { no: 1, unit: 'U5', title: 'Print a greeting and your name', mode: 'in_app',
    brief: 'Print a greeting followed by your own name.', starter: '# Program 1\n',
    tests: [{ name: 'prints something', requireSource: 'print\\s*\\(' }] },
  { no: 2, unit: 'U5', title: 'Add two numbers entered by the user', mode: 'in_app',
    brief: 'Ask for two numbers and print their sum.', starter: '# Program 2\n',
    tests: [{ name: '8 and 9 make 17', stdin: '8\n9\n', expect: '17' }] },
  { no: 3, unit: 'U5', title: 'Area of a rectangle', mode: 'in_app',
    brief: 'Ask for length and breadth, print the area.', starter: '# Program 3\n',
    tests: [{ name: '5 by 4 is 20', stdin: '5\n4\n', expect: '20' }] },
  { no: 4, unit: 'U5', title: 'Swap two numbers', mode: 'in_app',
    brief: 'Read two numbers, swap them, print both after swapping.', starter: '# Program 4\n',
    tests: [{ name: '3 and 8 become 8 and 3', stdin: '3\n8\n', expect: '8' }] },
  { no: 5, unit: 'U5', title: 'Largest of three numbers', mode: 'in_app',
    brief: 'Read three numbers and print the largest, using if and elif.', starter: '# Program 5\n',
    tests: [
      { name: '4, 9, 2 gives 9', stdin: '4\n9\n2\n', expect: '9', forbidSource: 'max\\s*\\(' },
      { name: '20, 5, 11 gives 20', stdin: '20\n5\n11\n', expect: '20' },
    ] },
  { no: 6, unit: 'U5', title: 'Even numbers using while', mode: 'in_app',
    brief: 'Print every even number from 2 to 20 using a while loop.', starter: '# Program 6\nn = 2\n',
    tests: [
      { name: 'uses a while loop', requireSource: 'while\\s' },
      { name: 'prints 20', expect: '20' },
    ] },
  { no: 7, unit: 'U5', title: 'Marks average using a list', mode: 'either',
    brief: 'Add up the marks with a loop and print the average, rounded to two decimal places. Do not use sum().',
    starter: 'marks = [78, 65, 90, 55, 82]\n\n# your code here\n',
    tests: [
      { name: 'uses a loop', requireSource: '(for\\s+\\w+\\s+in|while\\s)', hint: 'The task asks you to add the marks with a loop. No loop found in your code.' },
      { name: 'does not use sum()', forbidSource: 'sum\\s*\\(', hint: 'The task says not to use sum().' },
      { name: 'rounded to 2 decimals', expect: '74.0', hint: 'Hidden test expected the average rounded to 2 decimals. Try round(total/len(marks), 2).' },
    ] },
  { no: 8, unit: 'U5', title: 'Search a name in a list', mode: 'either',
    brief: 'Ask for a name and say whether it is in the class list.', starter: 'names = ["Aarav", "Divya", "Karthik", "Sana"]\n',
    tests: [{ name: 'finds Divya', stdin: 'Divya\n', expect: 'found' }] },
  { no: 9, unit: 'U5', title: 'Count the vowels in a word', mode: 'in_app',
    brief: 'Ask for a word and print how many vowels it has.', starter: '# Program 9\n',
    tests: [{ name: 'python has 1 vowel', stdin: 'python\n', expect: '1' }] },
  { no: 10, unit: 'U5', title: 'Multiplication table of any number', mode: 'in_app',
    brief: 'Ask for a number and print its table from 1 to 10 using a loop.', starter: '# Program 10\n',
    tests: [{ name: 'uses a loop', requireSource: '(for\\s+\\w+\\s+in|while\\s)' }] },
  { no: 11, unit: 'U5', title: 'Sum of the first n numbers', mode: 'in_app',
    brief: 'Ask for n and print 1 + 2 + ... + n.', starter: '# Program 11\n',
    tests: [{ name: 'n = 10 gives 55', stdin: '10\n', expect: '55' }] },
  { no: 12, unit: 'U5', title: 'Simple interest', mode: 'in_app',
    brief: 'Read principal, rate and time, print the simple interest.', starter: '# Program 12\n',
    tests: [{ name: '1000 at 5% for 2 years is 100', stdin: '1000\n5\n2\n', expect: '100' }] },
  { no: 13, unit: 'U5', title: 'Reverse a list without reverse()', mode: 'in_app',
    brief: 'Print the list backwards using a loop, not the reverse() method.', starter: 'items = [1, 2, 3, 4, 5]\n',
    tests: [
      { name: 'uses a loop', requireSource: '(for\\s+\\w+\\s+in|while\\s)' },
      { name: 'does not use reverse()', forbidSource: '\\.reverse\\s*\\(' },
    ] },
  { no: 14, unit: 'U3', title: 'Mean, median and mode of class marks', mode: 'either',
    brief: 'Given the marks list, print the mean, the median and the mode.', starter: 'marks = [78, 65, 90, 55, 82, 65]\n',
    tests: [{ name: 'prints three numbers', requireSource: 'print\\s*\\(' }] },
  { no: 15, unit: 'U3', title: 'Bar chart of class marks', mode: 'uploaded',
    brief: 'Draw a bar chart of the class marks on the lab computer and upload the sheet.', starter: '',
    tests: [] },
]

export const QUESTIONS: Array<{
  unit: string; kind: 'objective' | 'written'; text: string; options?: string[];
  answer?: number; marks: number; topic: string; model?: string
}> = [
  // --- U1 -----------------------------------------------------------------
  { unit: 'U1', kind: 'objective', marks: 1, topic: 'Definition', text: 'Which of these is the clearest sign that a system is using AI?',
    options: ['It runs on a fast computer', 'It improves at a task from data', 'It has a colourful interface', 'It is connected to the internet'], answer: 1 },
  { unit: 'U1', kind: 'objective', marks: 1, topic: 'Project cycle', text: 'Which stage of the AI project cycle comes first?',
    options: ['Modelling', 'Data acquisition', 'Problem scoping', 'Evaluation'], answer: 2 },
  { unit: 'U1', kind: 'objective', marks: 1, topic: 'Ethics', text: 'A face recognition system works poorly for some groups of people. The most likely cause is:',
    options: ['A slow processor', 'Training data that did not include them', 'Too many lines of code', 'A missing internet connection'], answer: 1 },
  { unit: 'U1', kind: 'objective', marks: 1, topic: 'Ethics', text: 'Who is responsible when an AI system makes an unfair decision?',
    options: ['Nobody, it is automatic', 'The people who built and deployed it', 'The computer', 'The person affected'], answer: 1 },
  { unit: 'U1', kind: 'written', marks: 5, topic: 'Ethics', text: 'Give one example of an AI system that could be unfair, and explain what its builders should have checked before releasing it.',
    model: 'Any concrete example plus a check on the training data or on outcomes for different groups.' },

  // --- U2 -----------------------------------------------------------------
  { unit: 'U2', kind: 'objective', marks: 1, topic: 'Sources', text: 'Data you collect yourself for your own project is called:',
    options: ['Secondary data', 'Primary data', 'Open data', 'Meta data'], answer: 1 },
  { unit: 'U2', kind: 'objective', marks: 1, topic: 'Cleaning', text: 'A survey row records an age of 250. The right first action is to:',
    options: ['Delete the whole survey', 'Treat it as an error and record it as missing', 'Round it down to 100', 'Leave it, data is data'], answer: 1 },
  { unit: 'U2', kind: 'objective', marks: 1, topic: 'Consent', text: 'Before collecting classmates\u2019 data for a project you should first:',
    options: ['Start collecting and ask later', 'Ask them, and explain what it is for', 'Only tell the teacher', 'Nothing, it is a school project'], answer: 1 },
  { unit: 'U2', kind: 'objective', marks: 1, topic: 'Quality', text: 'Two rows describe the same student twice. This is an example of:',
    options: ['A missing value', 'A duplicate', 'An outlier', 'A category'], answer: 1 },
  { unit: 'U2', kind: 'written', marks: 5, topic: 'Collection', text: 'You want to find out how students travel to school. Write the one question you would ask and explain why your wording avoids pushing people towards an answer.',
    model: 'A neutral question with mutually exclusive options and an "other" choice.' },

  // --- U3 -----------------------------------------------------------------
  { unit: 'U3', kind: 'objective', marks: 1, topic: 'Mean vs median', text: 'Marks are 12, 14, 15, 16 and 98. Which statement is true?',
    options: ['The mean describes the class well', 'The median describes the class better than the mean', 'Mean and median are equal', 'The mode is 98'], answer: 1 },
  { unit: 'U3', kind: 'objective', marks: 1, topic: 'Mode', text: 'The mode of 3, 7, 7, 9, 12 is:',
    options: ['3', '7', '9', '7.6'], answer: 1 },
  { unit: 'U3', kind: 'objective', marks: 1, topic: 'Charts', text: 'A bar chart whose vertical axis starts at 90 instead of 0 will:',
    options: ['Show differences accurately', 'Make small differences look large', 'Make large differences look small', 'Have no effect'], answer: 1 },
  { unit: 'U3', kind: 'objective', marks: 1, topic: 'Charts', text: 'Which chart is right for showing one quantity changing over twelve months?',
    options: ['Pie chart', 'Line chart', 'Scatter plot of names', 'Table only'], answer: 1 },
  { unit: 'U3', kind: 'objective', marks: 1, topic: 'Probability', text: 'A fair coin has landed heads four times. The probability the next toss is heads is:',
    options: ['Less than a half', 'Exactly a half', 'More than a half', 'Impossible to say'], answer: 1 },
  { unit: 'U3', kind: 'objective', marks: 1, topic: 'Probability', text: 'One card is drawn from a standard 52-card pack. The probability it is a heart is:',
    options: ['1/52', '1/13', '1/4', '1/2'], answer: 2 },
  { unit: 'U3', kind: 'objective', marks: 1, topic: 'Mean', text: 'The mean of 10, 20 and 30 is:',
    options: ['10', '20', '30', '60'], answer: 1 },
  { unit: 'U3', kind: 'written', marks: 5, topic: 'Mean vs median',
    text: 'Explain the difference between mean and median, and when median is the better choice.',
    model: 'Mean adds all values and divides by the count; median is the middle value in order. Median is better when extreme values would drag the mean away from what is typical.' },
  { unit: 'U3', kind: 'written', marks: 5, topic: 'Charts', text: 'A newspaper chart makes a 2% change look enormous. Explain how that is done and how a reader can spot it.',
    model: 'Truncated axis; check whether the axis starts at zero and read the scale.' },

  // --- U5 -----------------------------------------------------------------
  { unit: 'U5', kind: 'objective', marks: 1, topic: 'Types', text: 'What will print(type(5/2)) show in Python 3?',
    options: ["<class 'int'>", "<class 'float'>", "<class 'str'>", 'It raises an error'], answer: 1 },
  { unit: 'U5', kind: 'objective', marks: 1, topic: 'Loops', text: 'Which keyword starts a loop that runs a fixed number of times?',
    options: ['while', 'repeat', 'for', 'loop'], answer: 2 },
  { unit: 'U5', kind: 'objective', marks: 1, topic: 'Input', text: 'What does the input() function always return?',
    options: ['An integer', 'A float', 'A string', 'Whatever the user typed, in its own type'], answer: 2 },
  { unit: 'U5', kind: 'objective', marks: 1, topic: 'Ranges', text: 'How many numbers does range(1, 11) produce?',
    options: ['9', '10', '11', '12'], answer: 1 },
  { unit: 'U5', kind: 'objective', marks: 1, topic: 'Conditions', text: 'In an if / elif / else chain, the else block runs when:',
    options: ['Always', 'Only if every condition above was false', 'Only if the first condition was true', 'Never'], answer: 1 },
  { unit: 'U5', kind: 'objective', marks: 1, topic: 'Operators', text: 'What is the value of 7 % 2?',
    options: ['0', '1', '3', '3.5'], answer: 1 },
  { unit: 'U5', kind: 'objective', marks: 1, topic: 'Types', text: 'Which line converts the text "25" into a number?',
    options: ['str(25)', 'int("25")', 'float("twenty five")', 'print("25")'], answer: 1 },
  { unit: 'U5', kind: 'written', marks: 5, topic: 'Input', text: 'A student writes age = input("Age? ") then print(age + 1) and gets an error. Explain why, and give the corrected line.',
    model: 'input() returns a string, so + 1 mixes text and number. print(int(age) + 1).' },
]

export const BLUEPRINTS = [
  { unit: 'U1', title: 'Unit 1 — AI Reflection & Ethics', duration: 45, objectiveMarks: 20, writtenMarks: 15 },
  { unit: 'U2', title: 'Unit 2 — Data literacy', duration: 45, objectiveMarks: 20, writtenMarks: 15 },
  { unit: 'U3', title: 'Unit 3 — Maths for AI', duration: 45, objectiveMarks: 20, writtenMarks: 15 },
  { unit: 'U5', title: 'Unit 5 — Introduction to Python', duration: 45, objectiveMarks: 20, writtenMarks: 15 },
]
