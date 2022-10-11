import React, { ReactElement } from "react";

import Button from "./components/Button";

function App(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      Hello Vite! <Button>Button</Button>
    </div>
  );
}

export default App;
